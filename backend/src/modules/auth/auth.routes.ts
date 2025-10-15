import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { PrismaClient } from '@prisma/client';

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

export async function authRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  const authService = new AuthService(prisma);

  // Check if email exists
  fastify.post('/check-email', async (request: FastifyRequest<{ Body: CheckEmailBody }>, reply: FastifyReply) => {
    try {
      const { email } = request.body;

      if (!email || !email.includes('@')) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid email address',
        });
      }

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

  // Send verification code
  fastify.post('/send-code', async (request: FastifyRequest<{ Body: SendCodeBody }>, reply: FastifyReply) => {
    try {
      const { email } = request.body;

      if (!email || !email.includes('@')) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid email address',
        });
      }

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
  fastify.post('/verify-code', async (request: FastifyRequest<{ Body: VerifyCodeBody }>, reply: FastifyReply) => {
    try {
      const { code } = request.body;

      if (!code || code.length !== 6) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid verification code',
        });
      }

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
  fastify.post('/signup', async (request: FastifyRequest<{ Body: SignupBody }>, reply: FastifyReply) => {
    try {
      const { email, password, name } = request.body;

      if (!email || !password) {
        return reply.code(400).send({
          success: false,
          message: 'Email and password are required',
        });
      }

      if (password.length < 8) {
        return reply.code(400).send({
          success: false,
          message: 'Password must be at least 8 characters',
        });
      }

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
  fastify.post('/login', async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    try {
      const { email, password } = request.body;

      if (!email || !password) {
        return reply.code(400).send({
          success: false,
          message: 'Email and password are required',
        });
      }

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
      const { refreshToken } = request.body;

      if (!refreshToken) {
        return reply.code(400).send({
          success: false,
          message: 'Refresh token is required',
        });
      }

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
      const { refreshToken } = request.body;

      if (!refreshToken) {
        return reply.code(400).send({
          success: false,
          message: 'Refresh token is required',
        });
      }

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
