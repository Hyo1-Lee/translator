import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service';

// Zod 스키마 정의
const emailSchema = z.string()
  .email('올바른 이메일 형식이 아닙니다')
  .max(254, '이메일은 254자 이하여야 합니다')
  .transform(email => email.toLowerCase().trim());

const passwordSchema = z.string()
  .min(8, '비밀번호는 최소 8자 이상이어야 합니다')
  .max(128, '비밀번호는 128자 이하여야 합니다')
  .regex(/[A-Z]/, '비밀번호에 대문자가 포함되어야 합니다')
  .regex(/[a-z]/, '비밀번호에 소문자가 포함되어야 합니다')
  .regex(/[0-9]/, '비밀번호에 숫자가 포함되어야 합니다');

const verificationCodeSchema = z.string()
  .length(6, '인증 코드는 6자리여야 합니다')
  .regex(/^\d+$/, '인증 코드는 숫자만 포함해야 합니다');

const nameSchema = z.string()
  .min(1, '이름은 최소 1자 이상이어야 합니다')
  .max(50, '이름은 50자 이하여야 합니다')
  .optional();

const checkEmailBodySchema = z.object({
  email: emailSchema
});

const sendCodeBodySchema = z.object({
  email: emailSchema
});

const verifyCodeBodySchema = z.object({
  code: verificationCodeSchema
});

const signupBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema
});

const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, '비밀번호를 입력해주세요')
});

const refreshTokenBodySchema = z.object({
  refreshToken: z.string().min(1, '리프레시 토큰이 필요합니다')
});

// 인증 API Rate Limiting 설정 (분당 5회)
const authRateLimitConfig = {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '1 minute'
    }
  }
};

// 코드 발송은 더 엄격하게 (분당 3회)
const sendCodeRateLimitConfig = {
  config: {
    rateLimit: {
      max: 3,
      timeWindow: '1 minute'
    }
  }
};

interface CheckEmailBody {
  email: string;
}

interface SendCodeBody {
  email: string;
}

interface VerifyCodeBody {
  code: string;
}

interface SignupBody {
  email: string;
  password: string;
  name?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

interface RefreshTokenBody {
  refreshToken: string;
}

export async function authRoutes(fastify: FastifyInstance) {
  const authService = new AuthService();

  // Check if email exists
  fastify.post('/check-email', authRateLimitConfig, async (request: FastifyRequest<{ Body: CheckEmailBody }>, reply: FastifyReply) => {
    try {
      const parseResult = checkEmailBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          message: parseResult.error.errors[0].message,
        });
      }

      const { email } = parseResult.data;
      const result = await authService.checkEmail(email);

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('[Auth] Check email error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to check email',
      });
    }
  });

  // Send verification code (더 엄격한 제한)
  fastify.post('/send-code', sendCodeRateLimitConfig, async (request: FastifyRequest<{ Body: SendCodeBody }>, reply: FastifyReply) => {
    try {
      const parseResult = sendCodeBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          message: parseResult.error.errors[0].message,
        });
      }

      const { email } = parseResult.data;
      await authService.sendVerificationCode(email);

      return reply.send({
        success: true,
        message: 'Verification code sent successfully',
      });
    } catch (error: any) {
      console.error('[Auth] Send code error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Failed to send verification code',
      });
    }
  });

  // Verify code
  fastify.post('/verify-code', authRateLimitConfig, async (request: FastifyRequest<{ Body: VerifyCodeBody }>, reply: FastifyReply) => {
    try {
      const parseResult = verifyCodeBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          message: parseResult.error.errors[0].message,
        });
      }

      const { code } = parseResult.data;
      const email = await authService.verifyCode(code);

      return reply.send({
        success: true,
        data: { email },
      });
    } catch (error: any) {
      console.error('[Auth] Verify code error:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Invalid or expired verification code',
      });
    }
  });

  // Signup
  fastify.post('/signup', authRateLimitConfig, async (request: FastifyRequest<{ Body: SignupBody }>, reply: FastifyReply) => {
    try {
      const parseResult = signupBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          message: parseResult.error.errors[0].message,
        });
      }

      const { email, password, name } = parseResult.data;
      const result = await authService.register(email, password, name);

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('[Auth] Signup error:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Signup failed',
      });
    }
  });

  // Login
  fastify.post('/login', authRateLimitConfig, async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    try {
      const parseResult = loginBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          message: parseResult.error.errors[0].message,
        });
      }

      const { email, password } = parseResult.data;
      const result = await authService.login(email, password);

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('[Auth] Login error:', error);
      return reply.code(401).send({
        success: false,
        message: error.message || 'Login failed',
      });
    }
  });

  // Refresh token
  fastify.post('/refresh', async (request: FastifyRequest<{ Body: RefreshTokenBody }>, reply: FastifyReply) => {
    try {
      const parseResult = refreshTokenBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          message: parseResult.error.errors[0].message,
        });
      }

      const { refreshToken } = parseResult.data;
      const result = await authService.refreshAccessToken(refreshToken);

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error('[Auth] Refresh token error:', error);
      return reply.code(401).send({
        success: false,
        message: error.message || 'Failed to refresh token',
      });
    }
  });

  // Logout
  fastify.post('/logout', async (request: FastifyRequest<{ Body: RefreshTokenBody }>, reply: FastifyReply) => {
    try {
      const parseResult = refreshTokenBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          success: false,
          message: parseResult.error.errors[0].message,
        });
      }

      const { refreshToken } = parseResult.data;
      await authService.logout(refreshToken);

      return reply.send({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error: any) {
      console.error('[Auth] Logout error:', error);
      return reply.code(500).send({
        success: false,
        message: error.message || 'Logout failed',
      });
    }
  });

  // Get current user (protected route)
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({
          success: false,
          message: 'Unauthorized',
        });
      }

      const token = authHeader.substring(7);
      const payload = authService.verifyAccessToken(token);
      const user = await authService.getUserById(payload.userId);

      if (!user) {
        return reply.code(404).send({
          success: false,
          message: 'User not found',
        });
      }

      return reply.send({
        success: true,
        data: user,
      });
    } catch (error: any) {
      console.error('[Auth] Get me error:', error);
      return reply.code(401).send({
        success: false,
        message: error.message || 'Unauthorized',
      });
    }
  });
}
