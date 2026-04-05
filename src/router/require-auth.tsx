import React from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '@/utils/auth';

export const RequireAuth: React.FC<{ children: JSX.Element }> = ({ children }) => {
  const token = auth.getToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export const RootRedirect: React.FC = () => {
  const token = auth.getToken();
  return <Navigate to={token ? '/libraries' : '/login'} replace />;
};

