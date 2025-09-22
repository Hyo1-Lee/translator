/**
 * 6자리 랜덤 방 코드 생성
 */
export function generateRoomCode(): string {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';

  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return code;
}

/**
 * UUID 생성 (짧은 버전)
 */
export function generateShortId(): string {
  return Math.random().toString(36).substring(2, 10);
}