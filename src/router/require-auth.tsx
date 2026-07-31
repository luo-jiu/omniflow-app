import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export const RequireAuth: React.FC<{ children: JSX.Element }> = ({ children }) => {
  const { isLoggedIn, loading } = useAuth();
  if (loading) {
    return null;
  }
  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export const RootRedirect: React.FC = () => {
  const { isLoggedIn, loading } = useAuth();
  if (loading) {
    return null;
  }
  return <Navigate to={isLoggedIn ? '/libraries' : '/login'} replace />;
};
