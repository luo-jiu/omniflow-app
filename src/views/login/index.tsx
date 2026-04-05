import React, { useState } from 'react';
import { Form, Button, Card, Typography, Toast } from '@douyinfe/semi-ui';
import { IconUser, IconLock } from '@douyinfe/semi-icons';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

const LoginWrapper = styled.div`
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--app-bg);
  -webkit-app-region: drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .login-card {
    width: 400px;
    border: 1px solid var(--app-border);
    border-radius: 12px;
    padding: 36px;
    background: var(--app-bg-elevated);
    box-shadow: var(--app-shadow);
  }

  .login-header {
    text-align: center;
    margin-bottom: 32px;

    h2 {
      font-size: 24px !important;
      font-weight: 600;
      margin-bottom: 8px;
    }

    span {
      font-size: 14px !important;
      color: var(--app-text-muted);
    }
  }

  .semi-form-field {
    margin-bottom: 20px;

    label {
      font-size: 13px !important;
      margin-bottom: 6px;
    }

    .semi-input-wrapper {
      height: 40px;
      font-size: 14px;
      border-radius: 8px;

      .semi-input-prefix {
        font-size: 16px;
        margin-right: 8px;
      }
    }
  }

  .login-footer {
    margin-top: 20px;
    text-align: center;
    span {
      font-size: 13px !important;
      color: var(--app-text-muted);
    }
  }
`;

const Login: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const { Title, Text } = Typography;

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      const result = await login(values.username, values.password);
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

  return (
    <LoginWrapper>
      <Card className="login-card">
        <div className="login-header">
          <Title heading={2} style={{ fontSize: 24 }}>Omniflow</Title>
          <Text style={{ color: 'var(--app-text-muted)', fontSize: 14 }}>请登录您的账号</Text>
        </div>

        <Form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <Form.Input
            field="username"
            label="用户名"
            placeholder="请输入用户名"
            prefix={<IconUser />}
            rules={[{ required: true, message: '请输入用户名' }]}
          />
          <Form.Input
            field="password"
            label="密码"
            type="password"
            placeholder="请输入密码"
            prefix={<IconLock />}
            rules={[{ required: true, message: '请输入密码' }]}
          />
          <div style={{ marginTop: 24 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              size="default"
              style={{ borderRadius: 8, height: 40, fontSize: 14 }}
            >
              登录
            </Button>
          </div>
        </Form>

        <div className="login-footer">
          <Text style={{ color: 'var(--app-text-muted)', fontSize: 13 }}>
            演示账号: LJ / 密码: 123456
          </Text>
        </div>
      </Card>
    </LoginWrapper>
  );
};

export default Login;
