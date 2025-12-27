import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { sessionManager } from '../services/session-manager';
import { Room } from '../models/Room';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-in-production';

interface JWTPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Socket authentication middleware for speaker actions
 *
 * Validates that the socket has permission to perform speaker-only actions
 * Uses userId-based authentication instead of volatile socket.id
 */

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  roomId?: string;
  isAuthenticated?: boolean;
}

/**
 * Middleware to validate speaker authentication for a specific room action
 * Usage: Wrap socket event handlers that require speaker privileges
 */
export async function validateSpeakerAuth(
  socket: AuthenticatedSocket,
  roomId: string
): Promise<{ valid: boolean; room?: Room }> {
  const userId = socket.userId;

  if (!userId) {
    console.warn(`[SocketAuth] ❌ No userId found on socket ${socket.id}`);
    return { valid: false };
  }

  const room = await Room.findByPk(roomId);
  if (!room) {
    console.warn(`[SocketAuth] ❌ Room not found: ${roomId}`);
    return { valid: false };
  }

  const isValid = await sessionManager.validateSpeaker(roomId, userId);

  if (!isValid) {
    console.warn(
      `[SocketAuth] ❌ Unauthorized speaker attempt by socket ${socket.id} (userId: ${userId}) for room ${roomId}`
    );
  }

  return { valid: isValid, room };
}

/**
 * JWT 토큰을 검증하고 페이로드를 반환
 */
export function verifySocketToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Extracts userId from socket handshake auth
 * Supports both JWT token and direct userId (for backwards compatibility)
 * Should be called when socket first connects
 */
export function extractUserIdFromSocket(socket: Socket): { userId?: string; isAuthenticated: boolean } {
  const authData = socket.handshake.auth;

  // 1. JWT 토큰으로 인증 시도 (권장)
  if (authData && authData.token) {
    const payload = verifySocketToken(authData.token);
    if (payload) {
      return { userId: payload.userId, isAuthenticated: true };
    }
    console.warn(`[SocketAuth] ⚠️ Invalid JWT token for socket ${socket.id}`);
  }

  // 2. userId 직접 전달 (레거시 호환 - 비인증)
  if (authData && authData.userId) {
    console.warn(`[SocketAuth] ⚠️ Using unverified userId for socket ${socket.id} (legacy mode)`);
    return { userId: authData.userId, isAuthenticated: false };
  }

  // 3. Query params fallback (레거시 호환 - 비인증)
  const query = socket.handshake.query;
  if (query && typeof query.userId === 'string') {
    console.warn(`[SocketAuth] ⚠️ Using unverified userId from query for socket ${socket.id} (legacy mode)`);
    return { userId: query.userId, isAuthenticated: false };
  }

  return { userId: undefined, isAuthenticated: false };
}

/**
 * Attach userId to socket instance for later use
 */
export function attachUserIdToSocket(socket: AuthenticatedSocket): void {
  const { userId, isAuthenticated } = extractUserIdFromSocket(socket);
  if (userId) {
    socket.userId = userId;
    socket.isAuthenticated = isAuthenticated;
    console.log(`[SocketAuth] ✅ Attached userId to socket ${socket.id} (authenticated: ${isAuthenticated})`);
  } else {
    console.warn(`[SocketAuth] ⚠️ No userId found for socket ${socket.id}`);
  }
}

/**
 * Middleware wrapper for socket event handlers that require speaker auth
 * Automatically validates and returns early if unauthorized
 */
export function requireSpeakerAuth(
  handler: (socket: AuthenticatedSocket, room: Room, ...args: any[]) => Promise<void>
) {
  return async (socket: AuthenticatedSocket, ...args: any[]) => {
    // Extract roomId from first argument
    const roomId = args[0]?.roomId || args[0];

    if (!roomId || typeof roomId !== 'string') {
      console.warn(`[SocketAuth] ❌ No roomId provided in event handler`);
      socket.emit('error', { message: 'Room ID required' });
      return;
    }

    const { valid, room } = await validateSpeakerAuth(socket, roomId);

    if (!valid || !room) {
      socket.emit('unauthorized', {
        message: 'You are not authorized to perform this action',
        roomId,
      });
      return;
    }

    // Call the original handler with validated room
    await handler(socket, room, ...args);
  };
}
