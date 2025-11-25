import { Socket } from 'socket.io';
import { sessionManager } from '../services/session-manager';
import { Room } from '../models/Room';

/**
 * Socket authentication middleware for speaker actions
 *
 * Validates that the socket has permission to perform speaker-only actions
 * Uses userId-based authentication instead of volatile socket.id
 */

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  roomId?: string;
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
 * Extracts userId from socket handshake auth
 * Should be called when socket first connects
 */
export function extractUserIdFromSocket(socket: Socket): string | undefined {
  // Check handshake auth data
  const authData = socket.handshake.auth;

  // Try to get userId from auth data
  if (authData && authData.userId) {
    return authData.userId;
  }

  // Try to get from query params (fallback)
  const query = socket.handshake.query;
  if (query && typeof query.userId === 'string') {
    return query.userId;
  }

  return undefined;
}

/**
 * Attach userId to socket instance for later use
 */
export function attachUserIdToSocket(socket: AuthenticatedSocket): void {
  const userId = extractUserIdFromSocket(socket);
  if (userId) {
    socket.userId = userId;
    console.log(`[SocketAuth] ✅ Attached userId ${userId} to socket ${socket.id}`);
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
