'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';

interface User {
  id: string;
  email: string;
  name?: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (accessToken: string, refreshToken: string, user: User) => void;
  logout: () => void;
  refreshAccessToken: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load tokens and user from localStorage on mount
  useEffect(() => {
    const loadAuth = async () => {
      try {
        const storedAccessToken = localStorage.getItem('accessToken');
        const storedRefreshToken = localStorage.getItem('refreshToken');
        const storedUser = localStorage.getItem('user');

        if (storedAccessToken && storedUser) {
          setAccessToken(storedAccessToken);
          setUser(JSON.parse(storedUser));

          // Verify token is still valid by fetching user
          try {
            const response = await fetch(`${BACKEND_URL}/api/v1/auth/me`, {
              headers: {
                'Authorization': `Bearer ${storedAccessToken}`,
              },
            });

            if (!response.ok) {
              // Token expired, try to refresh
              if (storedRefreshToken) {
                const refreshed = await refreshTokenRequest(storedRefreshToken);
                if (!refreshed) {
                  // Refresh failed, clear auth
                  clearAuth();
                }
              } else {
                clearAuth();
              }
            } else {
              const data = await response.json();
              if (data.success && data.data) {
                setUser(data.data);
                localStorage.setItem('user', JSON.stringify(data.data));
              }
            }
          } catch (error) {
            console.error('Failed to verify token:', error);
            // Keep user logged in locally even if verification fails
          }
        }
      } catch (error) {
        console.error('Failed to load auth:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAuth();
  }, []);

  const login = (newAccessToken: string, newRefreshToken: string, newUser: User) => {
    setAccessToken(newAccessToken);
    setUser(newUser);
    localStorage.setItem('accessToken', newAccessToken);
    localStorage.setItem('refreshToken', newRefreshToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');

    // Call logout endpoint
    if (refreshToken) {
      try {
        await fetch(`${BACKEND_URL}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refreshToken }),
        });
      } catch (error) {
        console.error('Logout error:', error);
      }
    }

    clearAuth();
  };

  const clearAuth = () => {
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
  };

  const refreshTokenRequest = async (refreshToken: string): Promise<boolean> => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });

      const data = await response.json();

      if (response.ok && data.success && data.data.accessToken) {
        setAccessToken(data.data.accessToken);
        localStorage.setItem('accessToken', data.data.accessToken);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    }
  };

  const refreshAccessToken = async (): Promise<boolean> => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;

    return refreshTokenRequest(refreshToken);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isLoading,
        login,
        logout,
        refreshAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
