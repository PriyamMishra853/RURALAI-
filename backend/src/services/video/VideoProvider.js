/**
 * Video provider abstraction — spec §3.4.
 *
 * The consultation service calls ONLY this interface. It never imports
 * mediasoup types, never touches a Router, and never sees a worker. That is
 * what makes the provider swappable without editing scheduling or state-machine
 * code, and it is the reason the two implementations below can be selected at
 * runtime.
 *
 * Contract:
 *   createMeeting(consultationId)              -> { roomId, meetingUrl }
 *   getMeetingUrl(consultationId)              -> string
 *   joinMeeting(consultationId, userId, role)  -> JoinCredentials
 *   endMeeting(consultationId)                 -> void
 *
 * JoinCredentials are short-lived and per-user. Provider secrets, worker
 * internals and raw provider errors never cross this boundary (§7).
 */

export class VideoProviderError extends Error {
  constructor(message, { retryable = true, cause = null } = {}) {
    super(message);
    this.name = 'VideoProviderError';
    this.retryable = retryable;
    // The underlying error is kept for server-side logs only. §4.3: the client
    // gets a generic message, never a mediasoup stack trace.
    this.cause = cause;
  }
}

export class VideoProvider {
  /** Provider name persisted to consultations.meeting_provider. */
  get name() {
    throw new Error('VideoProvider.name must be implemented');
  }

  /**
   * Is this provider usable on this host right now? Checked once at startup so
   * a provider that cannot run (missing native worker, unreachable SFU) is
   * never selected and never fails mid-consultation.
   */
  async isAvailable() {
    return false;
  }

  async createMeeting(_consultationId) {
    throw new Error('createMeeting must be implemented');
  }

  async getMeetingUrl(consultationId) {
    return `/call/${consultationId}`;
  }

  async joinMeeting(_consultationId, _userId, _role) {
    throw new Error('joinMeeting must be implemented');
  }

  async endMeeting(_consultationId) {
    throw new Error('endMeeting must be implemented');
  }
}

/** The app-hosted join link. Never a raw provider URL — see §3.4. */
export const appMeetingUrl = (consultationId) => `/call/${consultationId}`;
