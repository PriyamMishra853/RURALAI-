import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  PhoneOff, Mic, MicOff, Video, VideoOff, Wifi, WifiOff,
  AlertTriangle, RefreshCw, Loader2, ArrowLeft, ShieldCheck
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { maskAadhaar } from '../config/patientFields';

/**
 * Consultation call screen.
 *
 * The backend is the authority: this page asks to join, and renders whatever
 * the join endpoint returns. It never decides that a call may start — the
 * window check, the participant check and the one-active-consultation rule all
 * live server-side, and a stale tab that thinks it can join simply gets a 409.
 *
 * Signalling reuses the app's single realtime socket rather than opening a
 * second one, so a dropped connection reconnects in one place.
 *
 * Media path depends on the provider the server selected:
 *   p2p       — direct RTCPeerConnection between the two peers (current host)
 *   mediasoup — SFU; the credentials carry transport parameters instead
 * Both arrive through the same `credentials` object, so this screen does not
 * branch on which one is active beyond choosing how to connect.
 */

const ROLE_LABEL = { DOCTOR: 'Doctor', CLINIC_ASSISTANT: 'Clinic Assistant' };

export default function CallPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { subscribe, sendMessage, connected } = useRealtime();

  const [consultation, setConsultation] = useState(null);
  const [phase, setPhase] = useState('joining');   // joining | waiting | live | ended | error
  const [error, setError] = useState(null);
  const [retryable, setRetryable] = useState(false);
  const [peerName, setPeerName] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const iceBufferRef = useRef([]);
  const startedAtRef = useRef(null);

  // ---- teardown -----------------------------------------------------------
  const teardown = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    try { pcRef.current?.close(); } catch { /* already closed */ }
    pcRef.current = null;
    iceBufferRef.current = [];
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // ---- WebRTC peer connection --------------------------------------------
  const buildPeerConnection = useCallback((iceServers) => {
    const pc = new RTCPeerConnection({ iceServers: iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] });

    pc.onicecandidate = (e) => {
      if (e.candidate) sendMessage({ type: 'call:ice', candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0];
        setPhase('live');
        if (!startedAtRef.current) startedAtRef.current = Date.now();
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        // Almost always a NAT that STUN cannot traverse. Say the useful thing
        // rather than "connection failed".
        setError('The media connection could not be established. This usually needs a TURN relay when the two sides are on different networks.');
        setRetryable(true);
      }
    };

    return pc;
  }, [sendMessage]);

  const attachLocalMedia = useCallback(async (pc) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  }, []);

  // ---- join ---------------------------------------------------------------
  const join = useCallback(async () => {
    setPhase('joining');
    setError(null);
    setRetryable(false);

    try {
      const res = await api.post(`/consultations/${id}/join`);
      const { consultation: c, credentials } = res.data;
      setConsultation(c);

      if (credentials.provider === 'mediasoup') {
        // The SFU path exchanges transport parameters over the same socket.
        // Not reachable on this host — the server selects p2p when the
        // mediasoup worker cannot run — so it is not wired up here.
        setError('The SFU provider is active but this client build only implements the peer-to-peer path.');
        setPhase('error');
        return;
      }

      const pc = buildPeerConnection(credentials.iceServers);
      pcRef.current = pc;
      await attachLocalMedia(pc);

      sendMessage({ type: 'call:join', consultationId: id });
      setPhase('waiting');
    } catch (err) {
      const data = err.response?.data;
      setError(data?.error || 'Could not join this consultation.');
      setRetryable(Boolean(data?.retryable));
      setPhase('error');
    }
  }, [id, buildPeerConnection, attachLocalMedia, sendMessage]);

  useEffect(() => { join(); }, [join]);

  // ---- signalling ---------------------------------------------------------
  useEffect(() => {
    const off = subscribe(async (msg) => {
      const pc = pcRef.current;

      switch (msg.type) {
        case 'call:joined': {
          if (msg.peers?.length) setPeerName(msg.peers[0].name);
          // Exactly one side creates the offer — the server elects the second
          // arrival, which is what prevents SDP glare.
          if (msg.initiator && pc) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendMessage({ type: 'call:offer', sdp: offer });
          }
          break;
        }

        case 'call:peer-joined':
          setPeerName(msg.name);
          break;

        case 'call:offer': {
          if (!pc) break;
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          for (const c of iceBufferRef.current) await pc.addIceCandidate(c).catch(() => {});
          iceBufferRef.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendMessage({ type: 'call:answer', sdp: answer });
          break;
        }

        case 'call:answer': {
          if (!pc) break;
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          for (const c of iceBufferRef.current) await pc.addIceCandidate(c).catch(() => {});
          iceBufferRef.current = [];
          break;
        }

        case 'call:ice': {
          if (!pc || !msg.candidate) break;
          const candidate = new RTCIceCandidate(msg.candidate);
          // Candidates can arrive before the remote description is set; buffer
          // them rather than dropping them, or the call connects one-way.
          if (pc.remoteDescription?.type) await pc.addIceCandidate(candidate).catch(() => {});
          else iceBufferRef.current.push(candidate);
          break;
        }

        case 'call:peer-left':
          setPeerName(null);
          setPhase('waiting');
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
          break;

        case 'call:ended':
          teardown();
          setPhase('ended');
          break;

        case 'call:error':
          setError(msg.message);
          break;

        default:
          break;
      }
    });
    return off;
  }, [subscribe, sendMessage, teardown]);

  // ---- call timer ---------------------------------------------------------
  useEffect(() => {
    if (phase !== 'live') return undefined;
    const t = setInterval(() => {
      if (startedAtRef.current) setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  // ---- controls -----------------------------------------------------------
  const toggleMic = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const toggleCam = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  };

  const endCall = async () => {
    sendMessage({ type: 'call:leave' });
    teardown();
    try { await api.post(`/consultations/${id}/end`); } catch { /* already ended server-side */ }
    setPhase('ended');
  };

  const leaveWithoutEnding = () => {
    sendMessage({ type: 'call:leave' });
    teardown();
    navigate(user?.role === 'DOCTOR' ? '/doctor/queue' : '/assistant/dashboard');
  };

  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const patient = consultation?.patients;

  return (
    <div className="min-h-[85vh] bg-surface-sunken -m-4 sm:-m-6 p-4 sm:p-6 flex flex-col gap-4">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={leaveWithoutEnding}
            aria-label="Back"
            className="p-2 rounded-field text-ink-subtle hover:bg-surface-raised/10"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-white truncate">
              {patient?.full_name || 'Consultation'}
            </h1>
            <p className="text-[11px] text-ink-subtle truncate">
              {patient?.aadhaar_number && <span className="font-mono">{maskAadhaar(patient.aadhaar_number)}</span>}
              {consultation?.visits?.chief_complaint && <> · {consultation.visits.chief_complaint}</>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {phase === 'live' && (
            <span className="px-2.5 py-1 rounded-field bg-tier-emergency/20 text-red-300 text-xs font-mono font-bold">
              {mmss(elapsed)}
            </span>
          )}
          <span className={`text-[11px] flex items-center gap-1 ${connected ? 'text-tier-low' : 'text-tier-moderate'}`}>
            {connected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5 animate-pulse" />}
            {connected ? 'Connected' : 'Reconnecting'}
          </span>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-field bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>{error}</p>
            {retryable && (
              <button
                type="button"
                onClick={join}
                className="mt-2 px-3 py-1.5 rounded-field bg-tier-emergency hover:opacity-90 text-white text-[11px] font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-[50vh]">
        <div className="lg:col-span-3 relative rounded-card overflow-hidden bg-black border border-white/10">
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-contain" />

          {phase !== 'live' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-ink-subtle">
              {phase === 'joining' && <><Loader2 className="w-8 h-8 animate-spin" /><p className="text-sm">Joining…</p></>}
              {phase === 'waiting' && (
                <>
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <p className="text-sm">Waiting for the {user?.role === 'DOCTOR' ? 'clinic assistant' : 'doctor'} to join…</p>
                  <p className="text-xs text-ink-muted">They have been notified.</p>
                </>
              )}
              {phase === 'ended' && (
                <>
                  <PhoneOff className="w-8 h-8" />
                  <p className="text-sm">Consultation ended</p>
                  <button
                    type="button"
                    onClick={leaveWithoutEnding}
                    className="mt-2 px-4 py-2 rounded-field bg-surface-raised/10 hover:bg-surface-raised/20 text-white text-xs font-semibold"
                  >
                    Back to dashboard
                  </button>
                </>
              )}
            </div>
          )}

          {peerName && phase === 'live' && (
            <span className="absolute bottom-3 left-3 px-2.5 py-1 rounded-field bg-black/60 text-white text-[11px] font-semibold">
              {peerName}
            </span>
          )}
        </div>

        <div className="space-y-4">
          <div className="relative rounded-card overflow-hidden bg-black border border-white/10 aspect-video">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 text-white text-[10px] font-semibold">
              You · {ROLE_LABEL[user?.role] || 'Participant'}
            </span>
            {!camOn && (
              <div className="absolute inset-0 bg-surface-sunken flex items-center justify-center">
                <VideoOff className="w-6 h-6 text-ink-muted" />
              </div>
            )}
          </div>

          {consultation && (
            <div className="p-3 rounded-card bg-surface-raised/5 border border-white/10 text-[11px] text-ink-subtle space-y-1.5">
              <div className="flex items-center gap-1.5 text-ink-subtle">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="font-semibold">Consultation</span>
              </div>
              <p>Type: {consultation.consultation_type}</p>
              <p>Status: {consultation.status}</p>
              {consultation.visits?.risk_level && <p>Risk: {consultation.visits.risk_level}</p>}
              <p className="text-ink-muted">
                Media: {consultation.meeting_provider === 'mediasoup' ? 'SFU' : 'peer-to-peer'}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={toggleMic}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          className={`p-3.5 rounded-full transition-colors ${micOn ? 'bg-surface-raised/10 hover:bg-surface-raised/20 text-white' : 'bg-tier-emergency hover:opacity-90 text-white'}`}
        >
          {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={toggleCam}
          aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
          className={`p-3.5 rounded-full transition-colors ${camOn ? 'bg-surface-raised/10 hover:bg-surface-raised/20 text-white' : 'bg-tier-emergency hover:opacity-90 text-white'}`}
        >
          {camOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>

        <button
          type="button"
          onClick={endCall}
          disabled={phase === 'ended'}
          className="px-6 py-3.5 rounded-full bg-tier-emergency hover:opacity-90 disabled:opacity-40 text-white font-semibold text-sm flex items-center gap-2"
        >
          <PhoneOff className="w-5 h-5" /> End consultation
        </button>
      </div>
    </div>
  );
}
