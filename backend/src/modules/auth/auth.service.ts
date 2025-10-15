import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-change-this';
const JWT_EXPIRES_IN = '1h';
const JWT_REFRESH_EXPIRES_IN = '7d';

export interface JWTPayload {
  userId: string;
  email: string;
}

export class AuthService {
  private prisma: PrismaClient;
  private transporter: nodemailer.Transporter;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;

    // Setup email transporter
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  // Generate 6-digit verification code
  private generateVerificationCode(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  // Send verification email
  async sendVerificationCode(email: string): Promise<void> {
    // Generate code
    const code = this.generateVerificationCode();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // 10 minutes expiry

    // Save to database
    await this.prisma.verificationCode.create({
      data: {
        email,
        code,
        expiresAt,
      },
    });

    // Send email
    await this.transporter.sendMail({
      from: `"ECHO Translation" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Your Verification Code - ECHO',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #2563eb; text-align: center;">ECHO Translation</h1>
          <div style="background: #f3f4f6; padding: 30px; border-radius: 10px; text-align: center;">
            <h2 style="color: #1f2937; margin-bottom: 20px;">Your Verification Code</h2>
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="font-size: 48px; font-weight: bold; color: #2563eb; margin: 0; letter-spacing: 8px;">
                ${code}
              </p>
            </div>
            <p style="color: #6b7280; font-size: 14px;">
              This code will expire in 10 minutes.
            </p>
          </div>
          <p style="color: #9ca3af; font-size: 12px; text-align: center; margin-top: 20px;">
            If you didn't request this code, please ignore this email.
          </p>
        </div>
      `,
    });

    console.log(`[Auth] Verification code sent to ${email}: ${code}`);
  }

  // Verify email code
  async verifyCode(code: string): Promise<string> {
    const verification = await this.prisma.verificationCode.findFirst({
      where: {
        code,
        isUsed: false,
        expiresAt: {
          gte: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!verification) {
      throw new Error('Invalid or expired verification code');
    }

    // Mark as used
    await this.prisma.verificationCode.update({
      where: { id: verification.id },
      data: { isUsed: true },
    });

    return verification.email;
  }

  // Check if email exists
  async checkEmail(email: string): Promise<{ exists: boolean; hasPassword: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    return {
      exists: !!user,
      hasPassword: !!user?.password,
    };
  }

  // Register new user
  async register(email: string, password: string, name?: string): Promise<{ user: any; tokens: any }> {
    // Check if user already exists
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing && existing.password) {
      throw new Error('User already exists with password');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create or update user
    const user = existing
      ? await this.prisma.user.update({
          where: { email },
          data: {
            password: hashedPassword,
            name: name || existing.name,
            isEmailVerified: true,
            lastLoginAt: new Date(),
          },
        })
      : await this.prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            name,
            isEmailVerified: true,
            lastLoginAt: new Date(),
          },
        });

    // Generate tokens
    const tokens = this.generateTokens(user.id, user.email);

    // Save refresh token
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      tokens,
    };
  }

  // Login existing user
  async login(email: string, password: string): Promise<{ user: any; tokens: any }> {
    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      throw new Error('Invalid email or password');
    }

    if (!user.isActive) {
      throw new Error('Account is deactivated');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate tokens
    const tokens = this.generateTokens(user.id, user.email);

    // Save refresh token
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      tokens,
    };
  }

  // Generate JWT tokens
  private generateTokens(userId: string, email: string) {
    const accessToken = jwt.sign(
      { userId, email } as JWTPayload,
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const refreshToken = jwt.sign(
      { userId, email } as JWTPayload,
      JWT_REFRESH_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );

    return { accessToken, refreshToken };
  }

  // Save refresh token
  private async saveRefreshToken(userId: string, token: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });
  }

  // Verify access token
  verifyAccessToken(token: string): JWTPayload {
    try {
      return jwt.verify(token, JWT_SECRET) as JWTPayload;
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  // Refresh access token
  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
    try {
      // Verify refresh token
      const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET) as JWTPayload;

      // Check if refresh token exists in database
      const tokenRecord = await this.prisma.refreshToken.findFirst({
        where: {
          token: refreshToken,
          userId: payload.userId,
          expiresAt: {
            gte: new Date(),
          },
        },
      });

      if (!tokenRecord) {
        throw new Error('Invalid refresh token');
      }

      // Generate new access token
      const accessToken = jwt.sign(
        { userId: payload.userId, email: payload.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      return { accessToken };
    } catch (error) {
      throw new Error('Invalid or expired refresh token');
    }
  }

  // Logout (invalidate refresh token)
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  // Get user by ID
  async getUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        isEmailVerified: true,
        createdAt: true,
      },
    });
  }
}
