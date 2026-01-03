import React, { useState } from 'react';
import { Form, Button, Card, Layout, Typography, Toast } from '@douyinfe/semi-ui';
import { IconUser, IconLock } from '@douyinfe/semi-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

const LoginWrapper = styled.div`
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--semi-color-bg-0);
  background-image: linear-gradient(135deg, var(--semi-color-primary-light-default) 0%, var(--semi-color-bg-0) 100%);

  .login-card {
    width: 600px; /* 400 * 1.5 */
    box-shadow: var(--semi-shadow-elevated);
    border-radius: 24px; /* 16 * 1.5 */
    padding: 45px; /* 30 * 1.5 */
  }

  .login-header {
    text-align: center;
    margin-bottom: 48px; /* 32 * 1.5 */
    
    h2 {
      font-size: 42px !important; /* 扩大标题 */
      margin-bottom: 12px;
    }
    
    span {
      font-size: 21px !important; /* 扩大副标题 */
    }
  }

  /* 扩大表单内元素 */
  .semi-form-field {
    margin-bottom: 30px;
    
    label {
      font-size: 18px !important;
      margin-bottom: 12px;
    }
    
    .semi-input-wrapper {
      height: 60px; /* 40 * 1.5 */
      font-size: 18px;
      
      .semi-input-prefix {
        font-size: 24px;
        margin-right: 12px;
      }
    }
  }

  .login-footer {
    margin-top: 30px;
    text-align: center;
    span {
      font-size: 18px !important;
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
          <Title heading={1} style={{ fontSize: 48 }}>Omniflow</Title>
          <Text sx={{ color: 'var(--semi-color-text-2)', fontSize: 21 }}>请登录您的账号</Text>
        </div>
        
        <Form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <Form.Input
            field="username"
            label="用户名"
            placeholder="请输入用户名"
            prefix={<IconUser style={{ fontSize: 24 }} />}
            rules={[{ required: true, message: '请输入用户名' }]}
            style={{ fontSize: 18 }}
          />
          <Form.Input
            field="password"
            label="密码"
            type="password"
            placeholder="请输入密码"
            prefix={<IconLock style={{ fontSize: 24 }} />}
            rules={[{ required: true, message: '请输入密码' }]}
            style={{ fontSize: 18 }}
          />
          <div style={{ marginTop: 36 }}>
            <Button 
              type="primary" 
              htmlType="submit" 
              block 
              loading={loading}
              size="large"
              style={{ borderRadius: 12, height: 60, fontSize: 21 }}
            >
              登录
            </Button>
          </div>
        </Form>
        
        <div className="login-footer">
          <Text size="normal" sx={{ color: 'var(--semi-color-text-2)', fontSize: 18 }}>
            演示账号: LJ / 密码: 123456
          </Text>
        </div>
      </Card>
    </LoginWrapper>
  );
};

export default Login;

