# Translator Backend - Prisma → MySQL + Sequelize 마이그레이션 가이드

**날짜**: 2025-10-24
**상태**: ✅ 모델 및 설정 완료, 코드 변환 필요

---

## 완료된 작업

### 1. ✅ Sequelize 모델 생성 (9개)
- `src/models/User.ts`
- `src/models/RefreshToken.ts`
- `src/models/VerificationCode.ts`
- `src/models/Room.ts`
- `src/models/RoomSettings.ts`
- `src/models/Listener.ts`
- `src/models/SttText.ts`
- `src/models/Transcript.ts`
- `src/models/SavedTranscript.ts`

### 2. ✅ 인프라 설정
- `src/config/index.ts` - 환경설정
- `src/infrastructure/database/sequelize.ts` - Sequelize 연결
- `tsconfig.json` - path alias 설정
- `.env` - MySQL 데이터베이스 설정

### 3. ✅ package.json 업데이트
- Prisma 제거
- Sequelize, MySQL2, Sequelize-TypeScript 추가
- reflect-metadata 추가

### 4. ✅ MySQL 데이터베이스 생성
- `translator_db` 데이터베이스 생성 완료

---

## 남은 작업

### Prisma → Sequelize 코드 변환이 필요한 파일 (7개)

1. **src/index.ts**
   - `PrismaClient` → Sequelize 연결
   - `prisma` 인스턴스 전달 제거

2. **src/modules/auth/auth.service.ts**
   - `prisma.user.create()` → `User.create()`
   - `prisma.refreshToken.create()` → `RefreshToken.create()`
   - `prisma.verificationCode.create()` → `VerificationCode.create()`

3. **src/modules/auth/auth.routes.ts**
   - prisma 의존성 제거

4. **src/modules/room/room-service.ts**
   - `prisma.room.*` → `Room.*`
   - `prisma.listener.*` → `Listener.*`
   - `prisma.roomSettings.*` → `RoomSettings.*`

5. **src/modules/room/transcript-service.ts**
   - `prisma.transcript.*` → `Transcript.*`
   - `prisma.sttText.*` → `SttText.*`

6. **src/modules/dashboard/dashboard.routes.ts**
   - prisma 의존성 제거

7. **src/cleanup-listeners.ts**
   - prisma 의존성 제거

---

## 빠른 변환 가이드

### Prisma → Sequelize 변환 패턴

#### 1. Create
```typescript
// Before (Prisma)
await prisma.user.create({
  data: {
    email,
    password,
    name
  }
});

// After (Sequelize)
await User.create({
  email,
  password,
  name
});
```

#### 2. Find One
```typescript
// Before
await prisma.user.findUnique({
  where: { email }
});

// After
await User.findOne({
  where: { email }
});
```

#### 3. Find Many
```typescript
// Before
await prisma.room.findMany({
  where: { userId },
  include: { listeners: true }
});

// After
await Room.findAll({
  where: { userId },
  include: [Listener]
});
```

#### 4. Update
```typescript
// Before
await prisma.user.update({
  where: { id },
  data: { name }
});

// After
const user = await User.findByPk(id);
await user.update({ name });
// OR
await User.update({ name }, { where: { id } });
```

#### 5. Delete
```typescript
// Before
await prisma.room.delete({
  where: { id }
});

// After
await Room.destroy({
  where: { id }
});
```

#### 6. Count
```typescript
// Before
await prisma.room.count({
  where: { status: 'ACTIVE' }
});

// After
await Room.count({
  where: { status: RoomStatus.ACTIVE }
});
```

---

## 자동 변환 스크립트

다음 스크립트를 사용하여 기본적인 변환을 자동화할 수 있습니다:

```bash
# 1. Prisma import 제거 및 모델 import 추가
find src -name "*.ts" -type f -exec sed -i 's/import { PrismaClient } from/@prisma/client//g' {} +

# 2. Constructor에서 prisma 제거
# 수동으로 각 service 파일 확인 필요
```

---

## 다음 단계

### Step 1: index.ts 업데이트
```typescript
import 'reflect-metadata';  // 추가!
import { connectDatabase } from './infrastructure/database/sequelize';

// PrismaClient 제거
// const prisma = new PrismaClient();

async function bootstrap() {
  // 데이터베이스 연결 추가
  await connectDatabase();

  // ... 나머지 코드

  // prisma 전달 제거
  const roomService = new RoomService();  // prisma 인자 제거
  const transcriptService = new TranscriptService();
}
```

### Step 2: Service 클래스 업데이트

각 service 파일에서:
1. Prisma import 제거
2. 필요한 모델 import 추가
3. constructor에서 prisma 매개변수 제거
4. prisma.model.* → Model.* 로 변경

### Step 3: 테스트 및 실행
```bash
# TypeScript 컴파일 확인
npm run typecheck

# 서버 실행
npm run dev
```

---

## 주의사항

1. **Relations 로딩**
   - Prisma의 `include`는 Sequelize의 `include`로 매핑
   - 모델 이름을 배열로 전달

2. **Timestamps**
   - Prisma: `createdAt`, `updatedAt`
   - Sequelize: 동일, 자동 관리됨

3. **UUID**
   - 모든 모델이 `@Default(DataType.UUIDV4)` 설정됨
   - 자동 생성됨

4. **Enum 타입**
   - RoomStatus는 `src/models/Room.ts`에서 export됨
   - `RoomStatus.ACTIVE` 형태로 사용

---

## 예상 시간

- **자동 변환 스크립트**: 10분
- **수동 수정 및 테스트**: 30-60분
- **전체**: 약 1-1.5시간

---

## 참고 자료

- Sequelize-TypeScript 문서: https://github.com/sequelize/sequelize-typescript
- Sequelize 문서: https://sequelize.org/docs/v6/
- PARALLAX backend 참고: 완료된 마이그레이션 예제

---

*이 문서는 PARALLAX 프로젝트 마이그레이션 경험을 바탕으로 작성되었습니다.*
