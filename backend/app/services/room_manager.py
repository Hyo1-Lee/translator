"""
방 관리 서비스 모듈
"""
import random
import string
from typing import Dict, Optional, Any
from app.models.room import Room, RoomStatus
from app.core.logger import setup_logger
from app.services.stt.rtzr_client import RTZRWebSocketClient
from app.services.stt.buffer import TranscriptBuffer

logger = setup_logger(__name__)


class RoomManager:
    """방 생성, 관리, 삭제 담당"""

    def __init__(self):
        self.rooms: Dict[str, Room] = {}

    def generate_room_id(self) -> str:
        """랜덤 방 ID 생성"""
        while True:
            room_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
            if room_id not in self.rooms:
                return room_id

    def create_room(self, speaker_sid: str, speaker_name: str = "Speaker", room_id: Optional[str] = None) -> Room:
        """새 방 생성"""
        if room_id is None:
            room_id = self.generate_room_id()

        room = Room(
            room_id=room_id,
            speaker_sid=speaker_sid,
            speaker_name=speaker_name
        )

        # STT 클라이언트 생성
        room.stt_client = RTZRWebSocketClient(room_id)

        self.rooms[room_id] = room
        logger.info(f"[{room_id}] 방 생성 - 연사: {speaker_name}")

        return room

    def get_room(self, room_id: str) -> Optional[Room]:
        """방 정보 조회"""
        return self.rooms.get(room_id)

    def add_listener(self, room_id: str, listener_sid: str) -> bool:
        """리스너 추가"""
        room = self.get_room(room_id)
        if not room:
            return False

        room.listeners.add(listener_sid)
        logger.info(f"[{room_id}] 청중 참가 (총 {len(room.listeners)}명)")
        return True

    def remove_listener(self, room_id: str, listener_sid: str) -> bool:
        """리스너 제거"""
        room = self.get_room(room_id)
        if not room:
            return False

        room.listeners.discard(listener_sid)
        logger.info(f"[{room_id}] 청중 퇴장 (남은 인원: {len(room.listeners)}명)")
        return True

    def close_room(self, room_id: str) -> bool:
        """방 종료"""
        room = self.get_room(room_id)
        if not room:
            return False

        room.status = RoomStatus.CLOSING

        # STT 클라이언트 정리
        if room.stt_client:
            room.stt_client.disconnect()

        # 방 삭제
        del self.rooms[room_id]
        logger.info(f"[{room_id}] 방 종료")
        return True

    def find_room_by_speaker(self, speaker_sid: str) -> Optional[str]:
        """스피커 세션 ID로 방 찾기"""
        for room_id, room in self.rooms.items():
            if room.speaker_sid == speaker_sid:
                return room_id
        return None

    def find_rooms_with_listener(self, listener_sid: str) -> list[str]:
        """리스너가 참가한 모든 방 찾기"""
        rooms = []
        for room_id, room in self.rooms.items():
            if listener_sid in room.listeners:
                rooms.append(room_id)
        return rooms

    def get_all_rooms_status(self) -> list[dict]:
        """모든 방 상태 조회"""
        status = []
        for room_id, room in self.rooms.items():
            status.append({
                'room_id': room_id,
                'speaker_name': room.speaker_name,
                'listener_count': len(room.listeners),
                'status': room.status.value,
                'created_at': room.created_at.isoformat(),
                'stt_connected': room.stt_client.connection_ready if room.stt_client else False
            })
        return status

    def get_total_listeners(self) -> int:
        """전체 리스너 수 조회"""
        return sum(len(room.listeners) for room in self.rooms.values())

    def cleanup_disconnected_user(self, session_id: str):
        """연결이 끊긴 사용자 정리"""
        # 스피커인 경우 방 종료
        room_id = self.find_room_by_speaker(session_id)
        if room_id:
            self.close_room(room_id)
            return

        # 리스너인 경우 모든 방에서 제거
        rooms = self.find_rooms_with_listener(session_id)
        for room_id in rooms:
            self.remove_listener(room_id, session_id)