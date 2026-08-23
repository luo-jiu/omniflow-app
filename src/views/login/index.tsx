import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconSun } from '@douyinfe/semi-icons';
import { Toast } from '@douyinfe/semi-ui';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

const AuthMoonIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M17 15c.48 0 .94-.05 1.39-.14a7 7 0 1 1-7.78-9.72A7 7 0 0 0 17 15Z"
      transform="translate(12 12) scale(1.5) translate(-12 -12)"
    />
  </svg>
);

const LoginWrapper = styled.div`
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&family=Cormorant+Garamond:wght@500;700&display=swap');

  --auth-bg: #dce6ee;
  --auth-card: #f7fbff;
  --auth-panel: #f3d6df;
  --auth-accent: #bd5d7b;
  --auth-accent-strong: #a84c67;
  --auth-text: #5f6a7d;
  --auth-heading: #ffffff;
  --auth-border: rgba(188, 93, 123, 0.28);
  --auth-card-shadow: 0 24px 48px rgba(41, 54, 78, 0.16);
  --auth-card-inset: rgba(255, 255, 255, 0.7);
  --auth-panel-shadow: 0 12px 28px rgba(41, 54, 78, 0.16);
  --auth-panel-glow-opacity: 1;
  --auth-input-bg: rgba(255, 255, 255, 0.26);
  --auth-input-bg-focus: rgba(255, 255, 255, 0.44);
  --auth-input-border: rgba(255, 255, 255, 0.48);
  --auth-input-border-focus: rgba(168, 76, 103, 0.56);
  --auth-input-text: #a84c67;
  --auth-placeholder: rgba(255, 255, 255, 0.94);
  --auth-submit-bg: rgba(255, 255, 255, 0.94);
  --auth-submit-text: #a84c67;
  --auth-submit-hover: #ecbfd0;
  --auth-panel-note: rgba(168, 76, 103, 0.92);
  --auth-login-tip: rgba(95, 106, 125, 0.82);
  --auth-side-action-bg: rgba(255, 255, 255, 0.82);
  --auth-theme-icon: #704051;
  --auth-theme-hover-bg: rgba(255, 255, 255, 0.28);
  --auth-theme-shadow: rgba(95, 106, 125, 0.16);
  --auth-light-backdrop-opacity: 1;
  --auth-dark-backdrop-opacity: 0;
  --auth-color-scheme: light;

  &[data-theme='dark'] {
    --auth-bg: #181d24;
    --auth-card: #242a31;
    --auth-panel: #4f333e;
    --auth-accent: #d88ca5;
    --auth-accent-strong: #e8a7bc;
    --auth-text: #b9c3d0;
    --auth-heading: #fbf2f5;
    --auth-border: rgba(216, 140, 165, 0.34);
    --auth-card-shadow: 0 24px 56px rgba(0, 0, 0, 0.38);
    --auth-card-inset: rgba(255, 255, 255, 0.05);
    --auth-panel-shadow: 0 18px 40px rgba(0, 0, 0, 0.32);
    --auth-panel-glow-opacity: 0.38;
    --auth-input-bg: rgba(255, 245, 248, 0.09);
    --auth-input-bg-focus: rgba(255, 245, 248, 0.15);
    --auth-input-border: rgba(255, 232, 239, 0.24);
    --auth-input-border-focus: rgba(232, 167, 188, 0.68);
    --auth-input-text: #f5e5ea;
    --auth-placeholder: rgba(255, 242, 247, 0.72);
    --auth-submit-bg: #f5edf0;
    --auth-submit-text: #9d465f;
    --auth-submit-hover: #ad5672;
    --auth-panel-note: #e8b5c5;
    --auth-login-tip: #d7b5c0;
    --auth-side-action-bg: rgba(255, 255, 255, 0.04);
    --auth-theme-icon: rgba(255, 232, 239, 0.82);
    --auth-theme-hover-bg: rgba(255, 255, 255, 0.08);
    --auth-theme-shadow: rgba(0, 0, 0, 0.28);
    --auth-light-backdrop-opacity: 0;
    --auth-dark-backdrop-opacity: 1;
    --auth-color-scheme: dark;
  }

  height: 100vh;
  width: 100vw;
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--auth-bg);
  color-scheme: var(--auth-color-scheme);
  -webkit-app-region: drag;
  overflow: hidden;
  transition: background-color 520ms cubic-bezier(0.22, 1, 0.36, 1);

  &::before,
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    transition: opacity 520ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  &::before {
    background:
      radial-gradient(1200px 520px at 50% -12%, rgba(255, 255, 255, 0.66), transparent 62%),
      linear-gradient(180deg, #e8f0f6 0%, #dce6ee 100%);
    opacity: var(--auth-light-backdrop-opacity);
  }

  &::after {
    background:
      radial-gradient(1000px 500px at 50% -14%, rgba(115, 78, 94, 0.2), transparent 64%),
      linear-gradient(180deg, #222a33 0%, #181d24 100%);
    opacity: var(--auth-dark-backdrop-opacity);
  }

  .auth-shell,
  .auth-shell * {
    -webkit-app-region: no-drag;
  }

  .auth-shell {
    width: min(900px, calc(100vw - 56px));
    height: min(580px, calc(100vh - 72px));
    min-height: 540px;
    position: relative;
    z-index: 1;
  }

  .welcome {
    --panel-width: 392px;
    --panel-gap: 36px;
    --panel-overshoot: 34px;

    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 14px;
    background-color: var(--auth-card);
    box-shadow:
      var(--auth-card-shadow),
      inset 0 0 0 1px var(--auth-card-inset);
    overflow: visible;
    transition:
      background-color 420ms cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .panel-box {
    position: absolute;
    top: calc(var(--panel-overshoot) * -1);
    left: var(--panel-gap);
    width: var(--panel-width);
    height: calc(100% + (var(--panel-overshoot) * 2));
    background-color: var(--auth-panel);
    border-radius: 14px;
    box-shadow: var(--auth-panel-shadow);
    transition:
      left 620ms cubic-bezier(0.2, 0.88, 0.32, 1),
      background-color 420ms cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 420ms cubic-bezier(0.22, 1, 0.36, 1);
    z-index: 3;
  }

  .panel-box::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: radial-gradient(760px 380px at 12% -22%, rgba(255, 255, 255, 0.36), transparent 56%);
    opacity: var(--auth-panel-glow-opacity);
    pointer-events: none;
    transition: opacity 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .welcome.is-signup .panel-box {
    left: calc(100% - var(--panel-width) - var(--panel-gap));
  }

  .panel {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 56px 32px 38px;
    display: flex;
    flex-direction: column;
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
    z-index: 1;
    transition:
      opacity 260ms ease 120ms,
      transform 360ms cubic-bezier(0.22, 1, 0.36, 1) 120ms,
      visibility 0s linear 0s;
  }

  .panel.nodisplay {
    opacity: 0;
    visibility: hidden;
    transform: translateY(8px);
    pointer-events: none;
    z-index: 0;
    transition:
      opacity 160ms ease,
      transform 220ms ease,
      visibility 0s linear 220ms;
  }

  .auth-theme-toggle {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 2;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--app-radius-medium, 10px);
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--auth-theme-icon);
    cursor: pointer;
    -webkit-app-region: no-drag;
    transition:
      background-color 180ms ease,
      color 180ms ease,
      box-shadow 180ms ease;
  }

  .auth-theme-toggle:hover {
    background: var(--auth-theme-hover-bg);
    box-shadow: 0 6px 16px var(--auth-theme-shadow);
  }

  .auth-theme-toggle:focus-visible {
    outline: 2px solid var(--auth-accent-strong);
    outline-offset: 2px;
  }

  .auth-theme-icon {
    grid-area: 1 / 1;
    width: 17px;
    height: 17px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--auth-theme-icon);
    transition:
      opacity 220ms ease,
      transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .auth-theme-icon svg {
    width: 17px;
    height: 17px;
    overflow: visible;
  }

  .auth-theme-icon svg path {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.25;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  .auth-theme-icon.sun svg path:not(:last-child) {
    fill: currentColor;
    stroke: none;
  }

  .auth-theme-icon.sun {
    opacity: 0;
    transform: rotate(-24deg) scale(0.72);
  }

  .auth-theme-icon.moon {
    opacity: 1;
    transform: rotate(0deg) scale(1);
  }

  &[data-theme='dark'] .auth-theme-icon.sun {
    opacity: 1;
    transform: rotate(0deg) scale(1);
  }

  &[data-theme='dark'] .auth-theme-icon.moon {
    opacity: 0;
    transform: rotate(24deg) scale(0.72);
  }

  .panel h1 {
    margin: 0;
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    text-align: center;
    color: var(--auth-heading);
    transition: color 220ms ease;
  }

  .auth-form {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  @keyframes auth-control-enter {
    from {
      opacity: 0;
      transform: translateY(7px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .panel:not(.nodisplay) .auth-form > * {
    animation: auth-control-enter 300ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .panel:not(.nodisplay) .auth-form > :nth-child(1) {
    animation-delay: 170ms;
  }

  .panel:not(.nodisplay) .auth-form > :nth-child(2) {
    animation-delay: 205ms;
  }

  .panel:not(.nodisplay) .auth-form > :nth-child(3) {
    animation-delay: 240ms;
  }

  .panel:not(.nodisplay) .auth-form > :nth-child(4) {
    animation-delay: 275ms;
  }

  .panel:not(.nodisplay) .auth-form > :nth-child(5) {
    animation-delay: 310ms;
  }

  .auth-form input {
    width: 100%;
    border: 1px solid var(--auth-input-border);
    background: var(--auth-input-bg);
    border-radius: 10px;
    color: var(--auth-input-text);
    padding: 12px 14px;
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 14px;
    outline: none;
    transition:
      border-color 180ms ease,
      background-color 180ms ease,
      color 180ms ease;
  }

  .auth-form input::placeholder {
    color: var(--auth-placeholder);
    letter-spacing: 0.5px;
    transition: color 180ms ease;
  }

  .auth-form input:focus {
    border-color: var(--auth-input-border-focus);
    background: var(--auth-input-bg-focus);
  }

  .submit-btn {
    margin-top: 12px;
    width: 100%;
    height: 42px;
    border-radius: 11px;
    border: 1px solid var(--auth-accent-strong);
    background: var(--auth-submit-bg);
    color: var(--auth-submit-text);
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      background-color 180ms ease,
      border-color 180ms ease,
      color 180ms ease,
      opacity 180ms ease;
  }

  .submit-btn:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }

  .submit-btn:not(:disabled):hover {
    background: var(--auth-submit-hover);
    border-color: var(--auth-submit-hover);
    color: var(--auth-heading);
  }

  .signup-note {
    margin-top: auto;
    text-align: center;
    color: var(--auth-panel-note);
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 12px;
    letter-spacing: 0.4px;
    transition: color 220ms ease;
  }

  .side {
    position: absolute;
    top: 0;
    width: 50%;
    height: 100%;
    padding: 56px 36px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    text-align: center;
    transition: opacity 320ms ease;
  }

  .side.left {
    left: 0;
  }

  .side.right {
    right: 0;
  }

  .side-title {
    margin: 0;
    font-family: 'Cormorant Garamond', 'STSong', serif;
    font-size: 44px;
    line-height: 0.95;
    letter-spacing: 1px;
    color: var(--auth-text);
    font-weight: 700;
    transition: color 220ms ease;
  }

  .brand-omni {
    color: var(--auth-accent);
  }

  .brand-flow {
    color: var(--auth-text);
  }

  .side.left .brand-omni {
    color: var(--auth-text);
  }

  .side.left .brand-flow {
    color: var(--auth-accent);
  }

  .side-desc {
    margin: 18px 0 0;
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 13px;
    letter-spacing: 1.6px;
    color: var(--auth-text);
    text-transform: uppercase;
    transition: color 220ms ease;
  }

  .deco-flower {
    margin-top: 34px;
    width: 130px;
    height: 130px;
    position: relative;
    isolation: isolate;
    overflow: hidden;
    flex: 0 0 auto;
    border-radius: 38% 62% 57% 43% / 42% 47% 53% 58%;
    transform: rotate(0deg) scale(1);
    box-shadow: 0 10px 20px rgba(95, 106, 125, 0.16);
    transition:
      border-radius 620ms cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 480ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 620ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .deco-flower::before,
  .deco-flower::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    pointer-events: none;
    transition:
      opacity 520ms cubic-bezier(0.22, 1, 0.36, 1),
      transform 620ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .deco-flower::before {
    background:
      radial-gradient(circle at 36% 30%, rgba(255, 255, 255, 0.9), transparent 42%),
      radial-gradient(circle at 60% 56%, rgba(189, 93, 123, 0.34), transparent 62%),
      linear-gradient(145deg, rgba(189, 93, 123, 0.22), rgba(95, 106, 125, 0.22));
    opacity: var(--auth-light-backdrop-opacity);
    transform: scale(1);
  }

  .deco-flower::after {
    background:
      radial-gradient(circle at 38% 28%, rgba(255, 242, 247, 0.34), transparent 40%),
      radial-gradient(circle at 62% 60%, rgba(203, 127, 151, 0.44), transparent 62%),
      linear-gradient(145deg, #66505f 0%, #394553 100%);
    opacity: var(--auth-dark-backdrop-opacity);
    transform: scale(0.94) rotate(-4deg);
  }

  .deco-flower.alt {
    border-radius: 64% 36% 46% 54% / 34% 58% 42% 66%;
    transform: rotate(-8deg) scale(1);
    box-shadow:
      0 12px 24px rgba(95, 106, 125, 0.18),
      inset 0 0 0 1px rgba(255, 255, 255, 0.42);
  }

  .deco-flower.alt::before {
    background:
      radial-gradient(circle at 66% 28%, rgba(255, 255, 255, 0.9), transparent 44%),
      radial-gradient(circle at 34% 68%, rgba(95, 106, 125, 0.22), transparent 60%),
      linear-gradient(145deg, rgba(95, 106, 125, 0.2), rgba(189, 93, 123, 0.28));
  }

  .deco-flower.alt::after {
    background:
      radial-gradient(circle at 64% 28%, rgba(255, 242, 247, 0.3), transparent 42%),
      radial-gradient(circle at 34% 70%, rgba(151, 158, 174, 0.38), transparent 60%),
      linear-gradient(145deg, #3d4857 0%, #6a4d5d 100%);
  }

  &[data-theme='dark'] .deco-flower {
    border-radius: 52% 48% 39% 61% / 46% 58% 42% 54%;
    transform: rotate(2deg) scale(0.985);
    box-shadow:
      0 18px 34px rgba(5, 8, 16, 0.36),
      inset 0 0 0 1px rgba(255, 228, 238, 0.12);
  }

  &[data-theme='dark'] .deco-flower::before {
    transform: scale(1.04) rotate(3deg);
  }

  &[data-theme='dark'] .deco-flower::after {
    transform: scale(1) rotate(0deg);
  }

  &[data-theme='dark'] .deco-flower.alt {
    border-radius: 42% 58% 62% 38% / 56% 39% 61% 44%;
    transform: rotate(-3deg) scale(0.985);
  }

  .side-account {
    margin-top: auto;
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 12px;
    color: var(--auth-text);
    letter-spacing: 0.8px;
    transition: color 220ms ease;
  }

  .toggle-btn {
    margin-top: 12px;
    width: 126px;
    height: 38px;
    border-radius: 11px;
    border: 1px solid var(--auth-border);
    background: var(--auth-side-action-bg);
    color: var(--auth-accent);
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 12px;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      background-color 180ms ease,
      border-color 180ms ease,
      color 180ms ease;
  }

  .toggle-btn:hover {
    background: var(--auth-panel);
    color: var(--auth-heading);
    border-color: transparent;
  }

  .login-tip {
    margin-top: 18px;
    font-size: 11px;
    letter-spacing: 0.5px;
    color: var(--auth-login-tip);
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    transition: color 220ms ease;
  }

  @media (max-width: 920px) {
    .auth-shell {
      width: min(560px, calc(100vw - 30px));
      height: min(760px, calc(100vh - 30px));
      min-height: 660px;
    }

    .welcome {
      --panel-gap: 20px;
      --panel-overshoot: 0px;
      --panel-width: calc(100% - 40px);
    }

    .panel-box,
    .welcome.is-signup .panel-box {
      top: 244px;
      left: 20px;
      height: calc(100% - 264px);
    }

    .side {
      width: 100%;
      height: 238px;
      padding: 24px 22px 14px;
    }

    .side.left {
      left: 0;
    }

    .side.right {
      left: 0;
      right: auto;
    }

    .welcome:not(.is-signup) .side.left {
      opacity: 0;
      pointer-events: none;
    }

    .welcome.is-signup .side.right {
      opacity: 0;
      pointer-events: none;
    }

    .side-title {
      font-size: 34px;
    }

    .side-desc {
      margin-top: 10px;
      font-size: 11px;
      letter-spacing: 1.2px;
    }

    .deco-flower {
      width: 48px;
      height: 48px;
      margin-top: 10px;
    }

    .deco-flower.alt {
      transform: rotate(-6deg);
    }

    .side-account {
      font-size: 11px;
    }

    .toggle-btn {
      width: 112px;
      height: 30px;
      margin-top: 6px;
    }
  }

  @media (max-width: 560px) {
    .auth-shell {
      width: calc(100vw - 18px);
      height: calc(100vh - 18px);
      min-height: 640px;
    }

    .panel {
      padding: 42px 18px 20px;
    }

    .auth-theme-toggle {
      top: 8px;
      right: 10px;
      width: 28px;
      height: 28px;
    }

    .panel h1 {
      font-size: 24px;
    }

    .side-title {
      font-size: 34px;
    }

    .side-desc {
      font-size: 11px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    &,
    &::before,
    &::after,
    .welcome,
    .panel-box,
    .panel-box::before,
    .panel,
    .panel h1,
    .auth-form input,
    .auth-form input::placeholder,
    .submit-btn,
    .signup-note,
    .side-title,
    .side-desc,
    .deco-flower,
    .deco-flower::before,
    .deco-flower::after,
    .side-account,
    .toggle-btn,
    .login-tip,
    .auth-theme-toggle,
    .auth-theme-icon {
      transition-duration: 0.01ms !important;
      transition-delay: 0ms !important;
    }

    .panel:not(.nodisplay) .auth-form > * {
      animation: none !important;
    }
  }
`;

const Login: React.FC = () => {
  const { login, register } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [signinUsername, setSigninUsername] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const signinUsernameRef = useRef<HTMLInputElement>(null);
  const signupUsernameRef = useRef<HTMLInputElement>(null);
  const modeFocusTimerRef = useRef<number | null>(null);

  const signInButtonText = useMemo(() => (loading ? 'Signing In...' : 'Sign In'), [loading]);
  const signUpButtonText = useMemo(() => (registering ? 'Creating...' : 'Create Account'), [registering]);
  const nextThemeLabel = resolvedTheme === 'dark' ? '日间模式' : '夜间模式';

  useEffect(() => () => {
    if (modeFocusTimerRef.current !== null) {
      window.clearTimeout(modeFocusTimerRef.current);
    }
  }, []);

  const switchMode = (nextMode: 'signin' | 'signup') => {
    if (nextMode === mode) return;
    setMode(nextMode);
    if (modeFocusTimerRef.current !== null) {
      window.clearTimeout(modeFocusTimerRef.current);
    }
    modeFocusTimerRef.current = window.setTimeout(() => {
      const target = nextMode === 'signin' ? signinUsernameRef.current : signupUsernameRef.current;
      target?.focus({ preventScroll: true });
      modeFocusTimerRef.current = null;
    }, 170);
  };

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const username = signinUsername.trim();
    const password = signinPassword.trim();
    if (!username || !password) {
      Toast.error('请输入用户名和密码');
      return;
    }
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.success) {
        Toast.success('登录成功');
        navigate('/libraries');
      } else {
        Toast.error(result.message || '登录失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const username = signupUsername.trim();
    const email = signupEmail.trim();
    const password = signupPassword.trim();
    const confirm = signupConfirm.trim();

    if (!username || !email || !password || !confirm) {
      Toast.error('请填写完整注册信息');
      return;
    }
    if (password !== confirm) {
      Toast.error('两次输入的密码不一致');
      return;
    }
    setRegistering(true);
    try {
      const result = await register({
        username,
        password,
        email,
      });
      if (!result.success) {
        Toast.error(result.message || '注册失败');
        return;
      }
      Toast.success('注册成功，请登录');
      setSigninUsername(username);
      switchMode('signin');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <LoginWrapper data-theme={resolvedTheme}>
      <div className="auth-shell">
        <div className={`welcome ${mode === 'signup' ? 'is-signup' : ''}`}>
          <div className="panel-box">
            <button
              className="auth-theme-toggle"
              type="button"
              aria-label={`切换到${nextThemeLabel}`}
              title={`切换到${nextThemeLabel}`}
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              <span className="auth-theme-icon moon" aria-hidden="true"><AuthMoonIcon /></span>
              <span className="auth-theme-icon sun" aria-hidden="true"><IconSun /></span>
            </button>

            <div
              className={`panel ${mode === 'signin' ? '' : 'nodisplay'}`}
              aria-hidden={mode !== 'signin'}
            >
              <h1>Welcome Back</h1>
              <form className="auth-form" autoComplete="off" onSubmit={handleSignIn}>
                <input
                  ref={signinUsernameRef}
                  type="text"
                  placeholder="workspace username"
                  value={signinUsername}
                  tabIndex={mode === 'signin' ? 0 : -1}
                  onChange={event => setSigninUsername(event.target.value)}
                />
                <input
                  type="password"
                  placeholder="account password"
                  value={signinPassword}
                  tabIndex={mode === 'signin' ? 0 : -1}
                  onChange={event => setSigninPassword(event.target.value)}
                />
                <button
                  className="submit-btn"
                  type="submit"
                  tabIndex={mode === 'signin' ? 0 : -1}
                  disabled={loading}
                >
                  {signInButtonText}
                </button>
              </form>
              <div className="login-tip">Keep your files organized, searchable, and always in flow.</div>
            </div>

            <div
              className={`panel ${mode === 'signup' ? '' : 'nodisplay'}`}
              aria-hidden={mode !== 'signup'}
            >
              <h1>Create Space</h1>
              <form className="auth-form" autoComplete="off" onSubmit={handleSignUp}>
                <input
                  ref={signupUsernameRef}
                  type="text"
                  placeholder="workspace username"
                  value={signupUsername}
                  tabIndex={mode === 'signup' ? 0 : -1}
                  onChange={event => setSignupUsername(event.target.value)}
                />
                <input
                  type="email"
                  placeholder="work email"
                  value={signupEmail}
                  tabIndex={mode === 'signup' ? 0 : -1}
                  onChange={event => setSignupEmail(event.target.value)}
                />
                <input
                  type="password"
                  placeholder="set password"
                  value={signupPassword}
                  tabIndex={mode === 'signup' ? 0 : -1}
                  onChange={event => setSignupPassword(event.target.value)}
                />
                <input
                  type="password"
                  placeholder="confirm password"
                  value={signupConfirm}
                  tabIndex={mode === 'signup' ? 0 : -1}
                  onChange={event => setSignupConfirm(event.target.value)}
                />
                <button
                  className="submit-btn"
                  type="submit"
                  tabIndex={mode === 'signup' ? 0 : -1}
                  disabled={registering}
                >
                  {signUpButtonText}
                </button>
              </form>
              <div className="signup-note">Create an account and start structuring your content library.</div>
            </div>
          </div>

          <div className="side left" aria-hidden={mode !== 'signup'}>
            <h2 className="side-title">
              <span className="brand-omni">OMNI</span><br />
              <span className="brand-flow">&amp; FLOW</span>
            </h2>
            <p className="side-desc">file system crafted for active creators</p>
            <div className="deco-flower" />
            <p className="side-account">Already inside the workspace?</p>
            <button
              className="toggle-btn"
              type="button"
              tabIndex={mode === 'signup' ? 0 : -1}
              onClick={() => switchMode('signin')}
            >
              Sign In
            </button>
          </div>

          <div className="side right" aria-hidden={mode !== 'signin'}>
            <h2 className="side-title">
              <span className="brand-omni">OMNI</span><br />
              <span className="brand-flow">&amp; FLOW</span>
            </h2>
            <p className="side-desc">build your own structured content hub</p>
            <div className="deco-flower alt" />
            <p className="side-account">Need a new workspace identity?</p>
            <button
              className="toggle-btn"
              type="button"
              tabIndex={mode === 'signin' ? 0 : -1}
              onClick={() => switchMode('signup')}
            >
              Sign Up
            </button>
          </div>
        </div>
      </div>
    </LoginWrapper>
  );
};

export default Login;
