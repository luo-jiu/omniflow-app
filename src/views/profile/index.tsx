import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled, { createGlobalStyle } from 'styled-components';
import { Avatar, Button, Divider, Input, Modal, Toast } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchCurrentUserProfile,
  updateCurrentUserProfile,
  updateCurrentUserPassword,
  uploadCurrentUserAvatar,
  type UserProfile,
} from '@/features/user/services/user.api';
import { runtimeLogger } from '@/utils/runtimeLogger';

const ProfileWrapper = styled.div`
  width: 100%;
  height: 100%;
  padding: 0;
  color: var(--semi-color-text-0);
  background: transparent;
  overflow: auto;
  -webkit-app-region: no-drag;

  & > * {
    -webkit-app-region: no-drag;
  }

  .profile-content {
    max-width: 616px;
    margin: 0 auto;
    padding: 0;
  }

  .avatar-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    margin-bottom: 16px;
  }

  .avatar-trigger {
    cursor: pointer;
    border: 1px solid var(--app-border);
    border-radius: 999px;
    padding: 2px;
    transition: border-color 0.2s ease;
  }

  .avatar-trigger:hover {
    border-color: var(--app-accent);
  }

  .avatar-tip {
    font-size: 11px;
    color: var(--app-text-muted);
    line-height: 1.5;
  }

  .form-row {
    margin-bottom: 13px;
  }

  .row-title {
    font-size: 13px;
    line-height: 1.35;
    font-weight: 600;
    color: var(--app-text-secondary);
    margin-bottom: 6px;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 7px;
  }

  .bottom-logout {
    margin-top: 18px;
    display: flex;
    justify-content: center;
  }

  .profile-action-btn {
    min-height: 30px;
    min-width: 72px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
  }

  .profile-action-btn.manage {
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-0);
    background: var(--semi-color-bg-0);
  }

  .profile-action-btn.manage:hover {
    background: var(--semi-color-bg-0);
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .profile-action-btn.manage:active {
    background: var(--semi-color-bg-0);
    border-color: color-mix(in srgb, var(--semi-color-primary) 78%, var(--semi-color-border) 22%);
    color: color-mix(in srgb, var(--semi-color-primary) 88%, var(--semi-color-text-0) 12%);
  }

  .profile-action-btn.manage:focus-visible {
    background: var(--semi-color-bg-0);
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .profile-action-btn.exit {
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-0);
    background: var(--semi-color-fill-0);
  }

  .profile-action-btn.exit:hover {
    background: rgba(220, 38, 38, 0.12);
    border-color: rgba(220, 38, 38, 0.46);
    color: #c03636;
  }

  .profile-action-btn.exit:active {
    background: rgba(220, 38, 38, 0.18);
    border-color: rgba(220, 38, 38, 0.56);
    color: #a92f2f;
  }

  .password-modal-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .password-modal-label {
    font-size: 11px;
    line-height: 1.35;
    font-weight: 600;
    color: var(--app-text-secondary);
    margin-bottom: 4px;
  }

  .profile-input.semi-input-wrapper,
  .profile-input .semi-input-wrapper,
  .profile-input .semi-input {
    font-size: 11px;
  }

  .profile-input.semi-input-wrapper,
  .profile-input .semi-input-wrapper {
    min-height: 30px;
    border-radius: 6px;
  }
`;

const ProfileModalGlobalStyle = createGlobalStyle`
  .profile-password-modal .semi-modal-content {
    border-radius: 8px;
  }

  .profile-password-modal .semi-modal-header {
    margin: 0;
    padding: 16px 18px 5px;
  }

  .profile-password-modal .semi-modal-title {
    font-size: 14px;
    line-height: 1.3;
    font-weight: 700;
  }

  .profile-password-modal .semi-modal-body {
    padding: 0 18px 14px;
  }

  .profile-password-modal .semi-modal-footer {
    margin: 0;
    padding: 0 18px 16px;
  }

  .profile-password-modal .profile-action-btn {
    min-height: 30px;
    min-width: 72px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
  }

  .profile-password-modal .profile-action-btn.manage {
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-0);
    background: var(--semi-color-bg-0);
  }

  .profile-password-modal .profile-action-btn.manage:hover {
    background: var(--semi-color-bg-0);
    border-color: var(--semi-color-primary);
    color: var(--semi-color-primary);
  }

  .profile-password-modal .profile-action-btn.exit {
    border: 1px solid var(--semi-color-border);
    color: var(--semi-color-text-0);
    background: var(--semi-color-fill-0);
  }

  .profile-password-modal .profile-action-btn.exit:hover {
    background: rgba(220, 38, 38, 0.12);
    border-color: rgba(220, 38, 38, 0.46);
    color: #c03636;
  }

  .profile-password-modal .password-modal-label {
    font-size: 11px;
    line-height: 1.35;
    font-weight: 600;
    color: var(--app-text-secondary);
    margin-bottom: 4px;
  }

  .profile-password-modal .password-modal-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .profile-password-modal .semi-input-wrapper,
  .profile-password-modal .semi-input {
    font-size: 11px;
  }

  .profile-password-modal .semi-input-wrapper {
    min-height: 30px;
    border-radius: 6px;
  }
`;

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, setUserInfo, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [nickname, setNickname] = useState('');
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const displayName = useMemo(() => {
    if (profile?.nickname) return profile.nickname;
    if (profile?.username) return profile.username;
    return user?.nickname || user?.username || 'U';
  }, [profile, user]);

  const syncAuthUser = (nextProfile: UserProfile) => {
    const merged = {
      ...(user || {}),
      id: nextProfile.id,
      username: nextProfile.username,
      nickname: nextProfile.nickname || nextProfile.username,
      avatar: nextProfile.avatar || undefined,
      ext: nextProfile.ext || undefined,
    };
    setUserInfo(merged);
  };

  const loadProfile = async () => {
    setLoading(true);
    try {
      const data = await fetchCurrentUserProfile();
      setProfile(data);
      setNickname(data.nickname || data.username || '');
      syncAuthUser(data);
    } catch (error) {
      runtimeLogger.error('Failed to load user profile:', error);
      Toast.error('加载个人资料失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickAvatar = () => {
    if (uploadingAvatar) return;
    fileInputRef.current?.click();
  };

  const onAvatarSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    setUploadingAvatar(true);
    try {
      const nextProfile = await uploadCurrentUserAvatar(file);
      setProfile(nextProfile);
      setNickname(nextProfile.nickname || nextProfile.username || '');
      syncAuthUser(nextProfile);
      Toast.success('头像已更新');
    } catch (error: any) {
      runtimeLogger.error('Failed to upload avatar:', error);
      Toast.error(error?.message || '头像上传失败');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const onSaveNickname = async () => {
    const nextNickname = nickname.trim();
    if (!nextNickname) {
      Toast.warning('昵称不能为空');
      return;
    }
    setSavingProfile(true);
    try {
      const nextProfile = await updateCurrentUserProfile({ nickname: nextNickname });
      setProfile(nextProfile);
      setNickname(nextProfile.nickname || nextProfile.username || nextNickname);
      syncAuthUser(nextProfile);
      Toast.success('昵称已保存');
    } catch (error: any) {
      runtimeLogger.error('Failed to save nickname:', error);
      Toast.error(error?.message || '昵称保存失败');
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async () => {
    if (!oldPassword) {
      Toast.warning('请输入旧密码');
      return;
    }
    if (!newPassword) {
      Toast.warning('请输入新密码');
      return;
    }
    setSavingPassword(true);
    try {
      await updateCurrentUserPassword({
        oldPassword,
        newPassword,
      });
      setOldPassword('');
      setNewPassword('');
      setPasswordModalVisible(false);
      Toast.success('密码已更新');
    } catch (error: any) {
      runtimeLogger.error('Failed to change password:', error);
      Toast.error(error?.message || '密码更新失败');
    } finally {
      setSavingPassword(false);
    }
  };

  const onLogout = () => {
    void (async () => {
      await logout();
      navigate('/login');
    })();
  };

  return (
    <ProfileWrapper>
      <ProfileModalGlobalStyle />
      <div className="profile-content">
        <div className="avatar-area">
          <div className="avatar-trigger" onClick={onPickAvatar} role="button" tabIndex={0}>
            <Avatar
              size="extra-large"
              src={profile?.avatar || user?.avatar}
              style={{
                width: 104,
                height: 104,
                fontSize: 36,
                backgroundColor: 'var(--app-accent)',
              }}
            >
              {displayName?.[0]?.toUpperCase() || 'U'}
            </Avatar>
          </div>
          <div className="avatar-tip">{uploadingAvatar ? '头像上传中...' : '点击头像上传新的图片'}</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onAvatarSelected}
            style={{ display: 'none' }}
          />
        </div>

        <Divider style={{ margin: '8px 0 16px' }} />

        <div className="form-row">
          <div className="row-title">昵称</div>
          <Input
            className="profile-input"
            value={nickname}
            placeholder="输入昵称"
            onChange={setNickname}
            disabled={loading}
          />
          <div className="form-actions">
            <Button
              theme="borderless"
              className="profile-action-btn manage"
              loading={savingProfile}
              onClick={onSaveNickname}
            >
              保存昵称
            </Button>
          </div>
        </div>

        <div className="form-row">
          <div className="row-title">邮箱（暂不可修改）</div>
          <Input className="profile-input" value={profile?.email || ''} disabled />
        </div>

        <div className="form-row">
          <div className="row-title">密码</div>
          <div className="form-actions">
            <Button
              theme="borderless"
              className="profile-action-btn manage"
              onClick={() => setPasswordModalVisible(true)}
            >
              修改密码
            </Button>
          </div>
        </div>

        <Divider style={{ margin: '16px 0 13px' }} />

        <div className="bottom-logout">
          <Button
            theme="borderless"
            className="profile-action-btn exit"
            onClick={onLogout}
          >
            退出登录
          </Button>
        </div>
      </div>

      <Modal
        className="profile-password-modal"
        title="修改密码"
        visible={passwordModalVisible}
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          margin: 0,
        }}
        okText="确认修改"
        cancelText="取消"
        okButtonProps={{
          theme: 'borderless',
          className: 'profile-action-btn manage',
        }}
        cancelButtonProps={{
          theme: 'borderless',
          className: 'profile-action-btn exit',
        }}
        confirmLoading={savingPassword}
        width={360}
        onOk={onChangePassword}
        onCancel={() => {
          if (savingPassword) return;
          setPasswordModalVisible(false);
          setOldPassword('');
          setNewPassword('');
        }}
      >
        <div className="password-modal-body">
          <div>
            <div className="password-modal-label">旧密码</div>
            <Input
              mode="password"
              placeholder="输入旧密码"
              value={oldPassword}
              onChange={setOldPassword}
            />
          </div>
          <div>
            <div className="password-modal-label">新密码</div>
            <Input
              mode="password"
              placeholder="输入新密码"
              value={newPassword}
              onChange={setNewPassword}
            />
          </div>
        </div>
      </Modal>
    </ProfileWrapper>
  );
};

export default ProfilePage;
