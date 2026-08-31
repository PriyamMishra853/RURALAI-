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
 * Two things make the call survive a bad network, which the first version of
 * this screen did not:
 *
 *   Membership is declarative. The server forgets a socket's call room the
 *   moment it disconnects, so `call:join` is re-sent on every reconnect rather
 *   than once at startup. Sending it once was the original bug — the socket
 *   authenticates against staff_profiles and is therefore still opening when
 *   this page mounts, so the only join message was routinely dropped and the
 *   far side waited forever for a peer the server never knew had arrived.
 *
 *   Negotiation is symmetric. Both sides use the perfect-negotiation pattern
 *   with a fixed politeness derived from role, so an offer collision resolves
 *   itself instead of deadlocking. Election by arrival order could not survive
 *   a rejoin, where both peers are already present.
 *
 * The media path is deliberately NOT rebuilt on a socket reconnect: WebRTC
 * media flows peer-to-peer and is unaffected by the signalling socket dropping.
 * Tearing it down would break a call that was still working.
 */

const ROLE_LABEL = { DOCTOR: 'Doctor', CLINIC_ASSISTANT: 'Clinic Assistant' };

/** Does this ICE server list include a relay? Without one, cross-network calls fail. */
const hasRelay = (iceServers) =>
  (iceServers || []).some((s) =>
    [].concat(s.urls || []).some((u) => String(u).startsWith('turn:') || String(u).startsWith('turns:'))
  );

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
  const [relayed, setRelayed] = useState(true);
  /** True once the HTTP join succeeded, so the reconnect effect has a room to rejoin. */
  const [inCall, setInCall] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const iceBufferRef = useRef([]);
  const startedAtRef = useRef(null);

  // Perfect-negotiation state (kept in refs: the negotiation callbacks read it
  // synchronously and must never see a stale render's copy).
  //
  // Politeness is fixed by role rather than by who arrived first. It has to
  // agree on both sides and stay agreed across reconnects, and role is the only
  // thing about a consultation that is guaranteed to be both.
  const politeRef = useRef(false);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const settingAnswerRef = useRef(false);

  politeRef.current = user?.role === 'DOCTOR';

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
    const pc = new RTCPeerConnection({
      iceServers: iceServers?.length ? iceServers : [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendMessage({ type: 'call:ice', candidate });
    };

    pc.ontrack = ({ streams }) => {
      if (remoteVideoRef.current && streams[0]) remoteVideoRef.current.srcObject = streams[0];
    };

    // Fires when local tracks are added and on every later renegotiation. The
    // whole point of perfect negotiation is that both sides may do this at any
    // time without coordinating first.
    pc.onnegotiationneeded = async () => {
      try {
        makingOfferRef.current = true;
        await pc.setLocalDescription();
        sendMessage({ type: 'call:offer', sdp: pc.localDescription });
      } catch (err) {
        console.error('Negotiation failed:', err);
      } finally {
        makingOfferRef.current = false;
      }
    };

    pc.oniceconnectionstatechange = () => {
      // A dropped route is often recoverable without rebuilding anything.
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setError(null);
        setRetryable(false);
        setPhase('live');
        if (!startedAtRef.current) startedAtRef.current = Date.now();
      }
      if (pc.connectionState === 'failed') {
        setError(
          hasRelay(iceServers)
            ? 'The media connection failed even through the relay. Check both sides’ network and retry.'
            : 'The media connection could not be established. This usually needs a TURN relay when the two sides are on different networks.'
        );
        setRetryable(true);
      }
    };

    return pc;
  }, [sendMessage]);

  const attachLocalMedia = useCallback(async (pc) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    // Adding tracks is what triggers onnegotiationneeded.
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  }, []);

  /**
   * Re-send a local offer that nobody could have answered.
   *
   * The first offer is created as soon as local tracks are added, which is
   * usually before the other side is in the room, so it is relayed to an empty
   * room and lost. When a peer does appear, this puts it back on the wire.
   */
  const resendPendingOffer = useCallback(() => {
    const pc = pcRef.current;
    if (!pc || !pc.localDescription) return;
    if (pc.signalingState !== 'have-local-offer') return;
    sendMessage({ type: 'call:offer', sdp: pc.localDescription });
  }, [sendMessage]);

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

      setRelayed(hasRelay(credentials.iceServers));

      const pc = buildPeerConnection(credentials.iceServers);
      pcRef.current = pc;
      await attachLocalMedia(pc);

      // Membership is now the reconnect effect's job, not a one-shot send.
      setInCall(true);
      setPhase('waiting');
    } catch (err) {
      const data = err.response?.data;
      setError(data?.error || err.message || 'Could not join this consultation.');
      setRetryable(Boolean(data?.retryable));
      setPhase('error');
    }
  }, [id, buildPeerConnection, attachLocalMedia]);

  // ---- signalling ---------------------------------------------------------
  // Registered before the join effect below, so no message can arrive before
  // there is a handler for it.
  useEffect(() => {
    const off = subscribe(async (msg) => {
      const pc = pcRef.current;

      switch (msg.type) {
        case 'call:joined': {
          if (msg.peers?.length) {
            setPeerName(msg.peers[0].name);
            resendPendingOffer();
          }
          break;
        }

        case 'call:peer-joined':
          setPeerName(msg.name);
          resendPendingOffer();
          break;

        case 'call:offer':
        case 'call:answer': {
          if (!pc) break;
          const description = msg.sdp;
          if (!description) break;

          try {
            // Perfect negotiation: the impolite peer ignores a colliding offer,
            // the polite peer rolls its own back and accepts. Exactly one side
            // yields, so the two can never deadlock waiting on each other.
            const readyForOffer =
              !makingOfferRef.current &&
              (pc.signalingState === 'stable' || settingAnswerRef.current);
            const collision = description.type === 'offer' && !readyForOffer;

            ignoreOfferRef.current = !politeRef.current && collision;
            if (ignoreOfferRef.current) break;

            settingAnswerRef.current = description.type === 'answer';
            await pc.setRemoteDescription(new RTCSessionDescription(description));
            settingAnswerRef.current = false;

            // Candidates that arrived before the remote description could be
            // applied; drain them now or media connects one-way.
            for (const c of iceBufferRef.current) await pc.addIceCandidate(c).catch(() => {});
            iceBufferRef.current = [];

            if (description.type === 'offer') {
              await pc.setLocalDescription();
              sendMessage({ type: 'call:answer', sdp: pc.localDescription });
            }
          } catch (err) {
            console.error('Failed to apply remote description:', err);
          }
          break;
        }

        case 'call:ice': {
          if (!pc || !msg.candidate) break;
          const candidate = new RTCIceCandidate(msg.candidate);
          if (pc.remoteDescription?.type) {
            await pc.addIceCandidate(candidate).catch((err) => {
              // Expected while we are deliberately ignoring a colliding offer.
              if (!ignoreOfferRef.current) console.warn('addIceCandidate failed:', err.message);
            });
          } else {
            iceBufferRef.current.push(candidate);
          }
          break;
        }

        case 'call:peer-left':
          // Keep the peer connection: they may come straight back, and the
          // renegotiation is cheaper than a fresh connection.
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
  }, [subscribe, sendMessage, teardown, resendPendingOffer]);

  useEffect(() => { join(); }, [join]);

  /**
   * Declare call membership on every (re)connect.
   *
   * The server drops a socket from its call room as soon as it disconnects, so
   * this has to run again on each reconnect — that is what makes a dropped
   * socket self-healing rather than the end of the consultation.
   */
  useEffect(() => {
    if (!inCall || !connected) return;
    sendMessage({ type: 'call:join', consultationId: id });
    resendPendingOffer();
  }, [inCall, connected, id, sendMessage, resendPendingOffer]);

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
    setInCall(false);
    teardown();
    try { await api.post(`/consultations/${id}/end`); } catch { /* already ended server-side */ }
    setPhase('ended');
  };

  const leaveWithoutEnding = () => {
    sendMessage({ type: 'call:leave' });
    setInCall(false);
    teardown();
    navigate(user?.role === 'DOCTOR' ? '/doctor/queue' : '/assistant/dashboard');
  };

  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const patient = consultation?.patients;

  // The call shell is always dark, in both themes. Call UIs are dark
  // everywhere for a reason — it cuts glare and puts the video first — and
  // every control on this screen is white-on-dark. The theme sweep briefly
  // made this surface light, which left all of those controls invisible.
  return (
    <div className="min-h-[85vh] bg-gov-950 dark:bg-gov-50 -m-4 sm:-m-6 p-4 sm:p-6 flex flex-col gap-4">

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

      {/* A missing relay only shows up as a call that never connects, and only
          for the pairs of users who happen to be on different networks. Saying
          so up front turns that into something an administrator can act on. */}
      {!relayed && phase !== 'error' && (
        <div className="p-2.5 rounded-field bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            No TURN relay is configured. Calls will connect on a shared network, but are likely to
            fail when the doctor and the clinic are on different networks.
          </span>
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
                {relayed && ' · relay available'}
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
