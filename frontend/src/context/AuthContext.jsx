import React, { createContext, useContext, useState } from 'react';
import api from '../services/api';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('vvc_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState(() => localStorage.getItem('vvc_token') || null);
  const [loading, setLoading] = useState(false);

  const persistSession = (jwtToken, userProfile) => {
    localStorage.setItem('vvc_token', jwtToken);
    localStorage.setItem('vvc_user', JSON.stringify(userProfile));
    setToken(jwtToken);
    setUser(userProfile);
  };

  const loginUser = async (email, password) => {
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      const { token: jwtToken, user: userProfile } = res.data;
      persistSession(jwtToken, userProfile);
      return userProfile;
    } finally {
      setLoading(false);
    }
  };

  const logoutUser = async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      // Session cleanup proceeds regardless
    }
    localStorage.removeItem('vvc_token');
    localStorage.removeItem('vvc_user');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, loginUser, logoutUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
