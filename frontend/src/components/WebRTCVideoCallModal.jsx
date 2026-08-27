import React, { useState, useEffect, useRef } from 'react';
import { PhoneOff, Mic, MicOff, Video, VideoOff, Wifi, AlertTriangle, ShieldCheck, RefreshCw, UserCheck } from 'lucide-react';

/**
 * Custom Pure WebRTC Video Call Component
 * Connects to the backend raw WebSocket signaling server on /signal
 * (proxied through Vite in dev) and uses native RTCPeerConnection.
 *
 * The server elects exactly one initiator per room (the second joiner),
 * which eliminates SDP offer glare.
 */

function buildIceConfig() {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  // Optional TURN relay (required for calls across restrictive NATs/networks)
  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || ''
    });
  }

  return { iceServers };
}

/**
 * Build the signaling URL.
 *
 * The socket now requires a bearer token and checks that the caller is a
 * recorded participant of that consultation — role and userId are read from
 * the verified token server-side, so passing them here would be ignored.
 *
 * The browser WebSocket API cannot set an Authorization header, so the token
 * travels as a query parameter. It is short-lived and the app does not log
 * this URL; that is the accepted trade.
 */
function buildSignalUrl(roomId) {
  const token = localStorage.getItem('vvc_token') || '';
  const params = `roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`;
  const override = import.meta.env.VITE_SIGNAL_URL; // e.g. wss://api.example.com/signal
  if (override) return `${override}?${params}`;

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/signal?${params}`;
}

const MAX_RECONNECT_ATTEMPTS = 5;

export default function WebRTCVideoCallModal({ roomId, userName, userId, role = 'CLINIC_ASSISTANT', peerName = 'Remote Participant', onClose }) {
  const [signalState, setSignalState] = useState('CONNECTING'); // CONNECTING | CONNECTED | RECONNECTING | DISCONNECTED
  const [peerConnState, setPeerConnState] = useState('NEW'); // NEW | CONNECTING | CONNECTED | DISCONNECTED | FAILED
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [peerJoined, setPeerJoined] = useState(false);
  const [callEndedReason, setCallEndedReason] = useState(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const iceCandidateBufferRef = useRef([]);
  const isInitiatorRef = useRef(false);
  const closedByUserRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    closedByUserRef.current = false;
    reconnectAttemptsRef.current = 0;

    function connectSignaling() {
      const wsUrl = buildSignalUrl(roomId);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) return;
        console.log('Connected to the signaling server.');
        reconnectAttemptsRef.current = 0;
        setSignalState('CONNECTED');
        ws.send(JSON.stringify({ type: 'join-room', roomId, role, userId }));
      };

      ws.onmessage = async (event) => {
        if (!isMounted) return;
        try {
          const data = JSON.parse(event.data);
          await handleIncomingSignalingMessage(data);
        } catch (err) {
          console.error('Signal parse error:', err);
        }
      };

      ws.onclose = () => {
        if (!isMounted || closedByUserRef.current) return;
        console.warn('🔌 Signaling WebSocket Disconnected');

        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setSignalState('DISCONNECTED');
          setCallEndedReason('Lost connection to the signaling server.');
          return;
        }

        setSignalState('RECONNECTING');
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 10000);
        reconnectAttemptsRef.current += 1;
        console.log(`🔄 Reconnecting WebSocket in ${delay}ms (attempt ${reconnectAttemptsRef.current})...`);
        reconnectTimerRef.current = setTimeout(() => {
          if (isMounted && !closedByUserRef.current) connectSignaling();
        }, delay);
      };

      ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
        // onclose fires right after onerror and drives reconnection.
      };
    }

    async function initWebRTC() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });

        // Component unmounted while the permission prompt was open —
        // release the camera/mic immediately.
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        connectSignaling();
      } catch (mediaErr) {
        console.error('Media stream error:', mediaErr);
        if (isMounted) setCallEndedReason('Camera/Microphone permission denied or device missing');
      }
    }

    initWebRTC();

    return () => {
      isMounted = false;
      cleanupCall();
    };
  }, [roomId]);

  // Always builds a FRESH RTCPeerConnection, closing any previous one, so
  // every (re)negotiation starts from a clean state.
  function createPeerConnection() {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
    }
    iceCandidateBufferRef.current = [];

    const pc = new RTCPeerConnection(buildIceConfig());
    pcRef.current = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    pc.ontrack = (event) => {
      console.log('🎥 Remote track received:', event.streams);
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ type: 'ice-candidate', roomId, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`📡 WebRTC PeerConnection State: ${pc.connectionState}`);
      setPeerConnState(pc.connectionState.toUpperCase());

      if (pc.connectionState === 'connected') {
        setCallEndedReason(null);
      } else if (pc.connectionState === 'failed') {
        // Try to recover with an ICE restart before giving up.
        if (isInitiatorRef.current) {
          console.warn('⚠️ Connection failed — attempting ICE restart...');
          makeOffer({ iceRestart: true });
        } else {
          setCallEndedReason('Media connection lost. Waiting for peer to reconnect...');
        }
      } else if (pc.connectionState === 'disconnected') {
        setCallEndedReason('Media connection interrupted. Attempting to recover...');
      }
    };

    return pc;
  }

  function sendSignal(payload) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }

  async function makeOffer({ iceRestart = false } = {}) {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'offer', roomId, sdp: offer });
    } catch (err) {
      console.error('Failed to create offer:', err);
    }
  }

  async function setRemoteAndFlushCandidates(pc, sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    while (iceCandidateBufferRef.current.length > 0) {
      const cand = iceCandidateBufferRef.current.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.error('Error adding buffered ICE candidate:', err);
      }
    }
  }

  async function handleIncomingSignalingMessage(data) {
    switch (data.type) {
      case 'peer-joined': {
        console.log(`👤 Peer Joined: ${data.userId} (${data.role}) — initiator: ${data.initiator}`);
        setPeerJoined(true);
        setCallEndedReason(null);

        // The server elects exactly one initiator per pairing. Both sides
        // rebuild their peer connection so rejoins renegotiate cleanly.
        isInitiatorRef.current = !!data.initiator;
        createPeerConnection();
        if (data.initiator) {
          await makeOffer();
        }
        break;
      }

      case 'offer': {
        console.log('📩 SDP Offer received');
        try {
          const pc = pcRef.current || createPeerConnection();
          await setRemoteAndFlushCandidates(pc, data.sdp);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ type: 'answer', roomId, sdp: answer });
        } catch (err) {
          console.error('Failed to handle offer:', err);
        }
        break;
      }

      case 'answer': {
        console.log('📩 SDP Answer received');
        try {
          const pc = pcRef.current;
          if (pc) await setRemoteAndFlushCandidates(pc, data.sdp);
        } catch (err) {
          console.error('Failed to set remote description from answer:', err);
        }
        break;
      }

      case 'ice-candidate': {
        if (!data.candidate) break;
        const pc = pcRef.current;
        try {
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } else {
            iceCandidateBufferRef.current.push(data.candidate);
          }
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
        break;
      }

      case 'peer-left': {
        console.warn(`👋 Peer left call: ${data.userId}`);
        setPeerJoined(false);
        setCallEndedReason(data.reason === 'DISCONNECTED' ? 'Peer connection lost unexpectedly.' : 'Peer left the video call.');

        // Tear down media state so a rejoining peer gets a fresh negotiation.
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        if (pcRef.current) {
          pcRef.current.close();
          pcRef.current = null;
        }
        iceCandidateBufferRef.current = [];
        setPeerConnState('NEW');
        break;
      }

      case 'error': {
        console.error('Signaling server error:', data.message);
        setCallEndedReason(data.message);
        break;
      }

      default:
        break;
    }
  }

  function toggleAudio() {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  }

  function toggleVideo() {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoMuted(!videoTrack.enabled);
      }
    }
  }

  function cleanupCall() {
    closedByUserRef.current = true;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'leave-room', roomId }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
  }

  function handleEndCall() {
    cleanupCall();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-surface-sunken/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-surface-sunken border border-line rounded-xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header Bar */}
        <div className="bg-surface-sunken px-5 py-3 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center font-bold text-xs">
              <Video className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                Teleconsultation Room <span className="font-mono text-xs text-blue-400">({roomId})</span>
              </h3>
              <p className="text-[11px] text-slate-400">User: <strong className="text-ink">{userName}</strong> ({role})</p>
            </div>
          </div>

          {/* Connection Status Indicators */}
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 bg-surface-sunken/80 px-2.5 py-1 rounded border border-line">
              <Wifi className={`w-3.5 h-3.5 ${signalState === 'CONNECTED' ? 'text-tier-low' : 'text-tier-moderate animate-pulse'}`} />
              <span className="text-[11px] text-slate-300">Signal: <strong className="text-ink">{signalState}</strong></span>
            </div>

            <div className="flex items-center gap-1.5 bg-surface-sunken/80 px-2.5 py-1 rounded border border-line">
              <ShieldCheck className={`w-3.5 h-3.5 ${peerConnState === 'CONNECTED' ? 'text-tier-low' : 'text-tier-moderate'}`} />
              <span className="text-[11px] text-slate-300">Media: <strong className="text-ink">{peerConnState}</strong></span>
            </div>
          </div>
        </div>

        {/* Video Display Grid */}
        <div className="relative flex-1 bg-surface-sunken p-4 grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[360px]">
          
          {/* Local Participant Video */}
          <div className="relative rounded-lg overflow-hidden bg-surface-sunken border border-line flex items-center justify-center">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted // Always mute local video to prevent audio echo
              className={`w-full h-full object-cover ${isVideoMuted ? 'hidden' : 'block'}`}
            />
            {isVideoMuted && (
              <div className="flex flex-col items-center gap-2 text-slate-400 text-xs">
                <VideoOff className="w-8 h-8 text-slate-500" />
                <span>Camera Turned Off</span>
              </div>
            )}
            <div className="absolute bottom-3 left-3 bg-surface-sunken/80 backdrop-blur px-2.5 py-1 rounded text-[11px] font-semibold text-ink border border-line">
              You ({userName}) {isAudioMuted && '🎤 Muted'}
            </div>
          </div>

          {/* Remote Participant Video */}
          <div className="relative rounded-lg overflow-hidden bg-surface-sunken border border-line flex items-center justify-center">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {peerConnState !== 'CONNECTED' && (
              <div className="absolute inset-0 bg-surface-sunken/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center space-y-3">
                {callEndedReason ? (
                  <>
                    <AlertTriangle className="w-10 h-10 text-amber-500" />
                    <div className="text-sm font-bold text-ink">{callEndedReason}</div>
                    <p className="text-xs text-slate-400">The video stream has ended.</p>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
                    <div className="text-sm font-bold text-ink">Waiting for {peerName} to join...</div>
                    <p className="text-xs text-slate-400">Share Room ID <code className="bg-surface-sunken px-1.5 py-0.5 rounded text-blue-300">{roomId}</code> with doctor or patient.</p>
                  </>
                )}
              </div>
            )}
            <div className="absolute bottom-3 left-3 bg-surface-sunken/80 backdrop-blur px-2.5 py-1 rounded text-[11px] font-semibold text-ink border border-line">
              {peerName}
            </div>
          </div>

        </div>

        {/* Control Toolbar */}
        <div className="bg-surface-sunken px-6 py-4 border-t border-line flex items-center justify-center gap-4">
          <button
            onClick={toggleAudio}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isAudioMuted ? 'bg-tier-emergency hover:opacity-90 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}
            title={isAudioMuted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </button>

          <button
            onClick={toggleVideo}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isVideoMuted ? 'bg-tier-emergency hover:opacity-90 text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}
            title={isVideoMuted ? 'Turn Camera On' : 'Turn Camera Off'}
          >
            {isVideoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
          </button>

          <button
            onClick={handleEndCall}
            className="px-6 h-12 rounded-full bg-tier-emergency hover:opacity-90 text-white font-bold text-xs flex items-center gap-2 shadow-lg transition-colors"
          >
            <PhoneOff className="w-5 h-5" /> END CONSULTATION
          </button>
        </div>

      </div>
    </div>
  );
}
