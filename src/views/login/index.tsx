import React, { useMemo, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

const LoginWrapper = styled.div`
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&family=Cormorant+Garamond:wght@500;700&display=swap');

  --auth-bg: #dce6ee;
  --auth-card: #f7fbff;
  --auth-panel: #f3d6df;
  --auth-accent: #bd5d7b;
  --auth-accent-strong: #a84c67;
  --auth-text: #5f6a7d;
  --auth-white: #ffffff;
  --auth-border: rgba(188, 93, 123, 0.28);

  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(1200px 520px at 50% -12%, rgba(255, 255, 255, 0.66), transparent 62%),
    linear-gradient(180deg, #e8f0f6 0%, var(--auth-bg) 100%);
  -webkit-app-region: drag;
  overflow: hidden;

  .auth-shell,
  .auth-shell * {
    -webkit-app-region: no-drag;
  }

  .auth-shell {
    width: min(900px, calc(100vw - 56px));
    height: min(580px, calc(100vh - 72px));
    min-height: 540px;
    position: relative;
  }

  .welcome {
    --panel-width: 392px;
    --panel-gap: 36px;
    --panel-overshoot: 34px;

    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 14px;
    background: var(--auth-card);
    box-shadow:
      0 24px 48px rgba(41, 54, 78, 0.16),
      inset 0 0 0 1px rgba(255, 255, 255, 0.7);
    overflow: visible;
  }

  .panel-box {
    position: absolute;
    top: calc(var(--panel-overshoot) * -1);
    left: var(--panel-gap);
    width: var(--panel-width);
    height: calc(100% + (var(--panel-overshoot) * 2));
    background:
      radial-gradient(760px 380px at 12% -22%, rgba(255, 255, 255, 0.36), transparent 56%),
      linear-gradient(180deg, #f4dae2 0%, var(--auth-panel) 100%);
    border-radius: 14px;
    box-shadow: 0 12px 28px rgba(41, 54, 78, 0.16);
    transition: left 620ms cubic-bezier(0.2, 0.88, 0.32, 1);
    z-index: 3;
  }

  .welcome.is-signup .panel-box {
    left: calc(100% - var(--panel-width) - var(--panel-gap));
  }

  .panel {
    width: 100%;
    height: 100%;
    padding: 56px 32px 38px;
    display: flex;
    flex-direction: column;
    position: relative;
    z-index: 1;
  }

  .panel.nodisplay {
    position: absolute;
    inset: 0;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    z-index: 0;
  }

  .panel h1 {
    margin: 0;
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    text-align: center;
    color: var(--auth-white);
  }

  .auth-form {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .auth-form input {
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.48);
    background: rgba(255, 255, 255, 0.26);
    border-radius: 10px;
    color: var(--auth-accent-strong);
    padding: 12px 14px;
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 14px;
    outline: none;
    transition: border-color 140ms ease, background-color 140ms ease;
  }

  .auth-form input::placeholder {
    color: rgba(255, 255, 255, 0.94);
    letter-spacing: 0.5px;
  }

  .auth-form input:focus {
    border-color: rgba(168, 76, 103, 0.56);
    background: rgba(255, 255, 255, 0.44);
  }

  .submit-btn {
    margin-top: 12px;
    width: 100%;
    height: 42px;
    border-radius: 11px;
    border: 1px solid var(--auth-accent-strong);
    background: rgba(255, 255, 255, 0.94);
    color: var(--auth-accent-strong);
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 180ms ease;
  }

  .submit-btn:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }

  .submit-btn:not(:disabled):hover {
    background: #ecbfd0;
    border-color: #ecbfd0;
    color: var(--auth-white);
  }

  .signup-note {
    margin-top: auto;
    text-align: center;
    color: rgba(168, 76, 103, 0.92);
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 12px;
    letter-spacing: 0.4px;
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
  }

  .side-title span {
    color: var(--auth-accent);
  }

  .side-desc {
    margin: 18px 0 0;
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 13px;
    letter-spacing: 1.6px;
    color: var(--auth-text);
    text-transform: uppercase;
  }

  .deco-flower {
    margin-top: 34px;
    width: 130px;
    height: 130px;
    border-radius: 38% 62% 57% 43% / 42% 47% 53% 58%;
    background:
      radial-gradient(circle at 36% 30%, rgba(255, 255, 255, 0.9), transparent 42%),
      radial-gradient(circle at 60% 56%, rgba(189, 93, 123, 0.34), transparent 62%),
      linear-gradient(145deg, rgba(189, 93, 123, 0.22), rgba(95, 106, 125, 0.22));
    box-shadow: 0 10px 20px rgba(95, 106, 125, 0.16);
  }

  .deco-flower.alt {
    border-radius: 64% 36% 46% 54% / 34% 58% 42% 66%;
    background:
      radial-gradient(circle at 66% 28%, rgba(255, 255, 255, 0.9), transparent 44%),
      radial-gradient(circle at 34% 68%, rgba(95, 106, 125, 0.22), transparent 60%),
      linear-gradient(145deg, rgba(95, 106, 125, 0.2), rgba(189, 93, 123, 0.28));
    box-shadow:
      0 12px 24px rgba(95, 106, 125, 0.18),
      inset 0 0 0 1px rgba(255, 255, 255, 0.42);
    transform: rotate(-8deg);
  }

  .side-account {
    margin-top: auto;
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 12px;
    color: var(--auth-text);
    letter-spacing: 0.8px;
  }

  .toggle-btn {
    margin-top: 12px;
    width: 126px;
    height: 38px;
    border-radius: 11px;
    border: 1px solid var(--auth-border);
    background: rgba(255, 255, 255, 0.82);
    color: var(--auth-accent);
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
    font-size: 12px;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 180ms ease;
  }

  .toggle-btn:hover {
    background: var(--auth-panel);
    color: var(--auth-white);
    border-color: transparent;
  }

  .login-tip {
    margin-top: 18px;
    font-size: 11px;
    letter-spacing: 0.5px;
    color: rgba(95, 106, 125, 0.82);
    font-family: 'Manrope', 'Noto Sans SC', sans-serif;
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
      padding: 30px 22px 20px;
    }

    .side.left {
      left: 0;
    }

    .side.right {
      left: 0;
      right: auto;
    }

    .welcome:not(.is-signup) .side.right {
      opacity: 0;
      pointer-events: none;
    }

    .welcome.is-signup .side.left {
      opacity: 0;
      pointer-events: none;
    }

    .side-title {
      font-size: 38px;
    }

    .deco-flower {
      width: 86px;
      height: 86px;
      margin-top: 16px;
    }

    .deco-flower.alt {
      transform: rotate(-6deg);
    }
  }

  @media (max-width: 560px) {
    .auth-shell {
      width: calc(100vw - 18px);
      height: calc(100vh - 18px);
      min-height: 640px;
    }

    .panel {
      padding: 34px 18px 24px;
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
`;

const Login: React.FC = () => {
  const { login, register } = useAuth();
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

  const signInButtonText = useMemo(() => (loading ? 'Signing In...' : 'Sign In'), [loading]);
  const signUpButtonText = useMemo(() => (registering ? 'Creating...' : 'Create Account'), [registering]);

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
      setMode('signin');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <LoginWrapper>
      <div className="auth-shell">
        <div className={`welcome ${mode === 'signup' ? 'is-signup' : ''}`}>
          <div className="panel-box">
            <div className={`panel ${mode === 'signin' ? '' : 'nodisplay'}`}>
              <h1>Welcome Back</h1>
              <form className="auth-form" autoComplete="off" onSubmit={handleSignIn}>
                <input
                  type="text"
                  placeholder="workspace username"
                  value={signinUsername}
                  onChange={event => setSigninUsername(event.target.value)}
                />
                <input
                  type="password"
                  placeholder="account password"
                  value={signinPassword}
                  onChange={event => setSigninPassword(event.target.value)}
                />
                <button className="submit-btn" type="submit" disabled={loading}>
                  {signInButtonText}
                </button>
              </form>
              <div className="login-tip">Keep your files organized, searchable, and always in flow.</div>
            </div>

            <div className={`panel ${mode === 'signup' ? '' : 'nodisplay'}`}>
              <h1>Create Space</h1>
              <form className="auth-form" autoComplete="off" onSubmit={handleSignUp}>
                <input
                  type="text"
                  placeholder="workspace username"
                  value={signupUsername}
                  onChange={event => setSignupUsername(event.target.value)}
                />
                <input
                  type="email"
                  placeholder="work email"
                  value={signupEmail}
                  onChange={event => setSignupEmail(event.target.value)}
                />
                <input
                  type="password"
                  placeholder="set password"
                  value={signupPassword}
                  onChange={event => setSignupPassword(event.target.value)}
                />
                <input
                  type="password"
                  placeholder="confirm password"
                  value={signupConfirm}
                  onChange={event => setSignupConfirm(event.target.value)}
                />
                <button className="submit-btn" type="submit" disabled={registering}>
                  {signUpButtonText}
                </button>
              </form>
              <div className="signup-note">Create an account and start structuring your content library.</div>
            </div>
          </div>

          <div className="side left">
            <h2 className="side-title"><span>OMNI</span><br />&amp; FLOW</h2>
            <p className="side-desc">file system crafted for active creators</p>
            <div className="deco-flower" />
            <p className="side-account">Already inside the workspace?</p>
            <button className="toggle-btn" type="button" onClick={() => setMode('signin')}>
              Sign In
            </button>
          </div>

          <div className="side right">
            <h2 className="side-title"><span>OMNI</span><br />&amp; FLOW</h2>
            <p className="side-desc">build your own structured content hub</p>
            <div className="deco-flower alt" />
            <p className="side-account">Need a new workspace identity?</p>
            <button className="toggle-btn" type="button" onClick={() => setMode('signup')}>
              Sign Up
            </button>
          </div>
        </div>
      </div>
    </LoginWrapper>
  );
};

export default Login;
