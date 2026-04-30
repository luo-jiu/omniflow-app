import React from 'react';
import EmbeddedBrowserCookieSettings from '@/features/embedded-browser/cookies/components/EmbeddedBrowserCookieSettings';
import EmbeddedBrowserPasswordSettings from '@/features/embedded-browser/passwords/components/EmbeddedBrowserPasswordSettings';
import EmbeddedBrowserCaptureRuleSettings from '@/features/embedded-browser/resources/components/EmbeddedBrowserCaptureRuleSettings';
import EmbeddedBrowserExternalToolSettings from '@/features/embedded-browser/external-tools/components/EmbeddedBrowserExternalToolSettings';
import { BrowserSettingsContent } from './layout-styles';

export type BrowserSettingsSection = 'cookies' | 'passwords' | 'capture-rules' | 'external-tools';

type BrowserSettingsWorkspaceProps = {
  section: BrowserSettingsSection | null;
  onSectionChange: (section: BrowserSettingsSection | null) => void;
};

type BrowserSettingsCard = {
  body: string;
  chip: string;
  section?: BrowserSettingsSection;
  title: string;
};

const browserSettingsCards: BrowserSettingsCard[] = [
  {
    chip: '资源捕获',
    section: 'capture-rules',
    title: '捕获规则',
    body: '管理扩展名、MIME、正则规则和域名黑白名单，决定哪些网页资源会进入捕获列表。',
  },
  {
    chip: '外部工具',
    section: 'external-tools',
    title: '发送到外部下载器',
    body: '配置 aria2 RPC、本地命令和 URL 协议，把当前资源直接发给外部下载工具。',
  },
  {
    chip: 'Cookie 管理',
    section: 'cookies',
    title: 'Cookie 与站点数据',
    body: '查看、搜索和清除内置浏览器的 Cookie，按域名管理站点登录态和站点数据。',
  },
  {
    chip: '密码管理',
    section: 'passwords',
    title: '已保存的密码',
    body: '查看和管理内置浏览器保存的网站登录密码，查看密码需要通过 Touch ID 验证。',
  },
  {
    chip: '比较顺手',
    title: '下载与文件行为',
    body: '后续可以继续补默认下载位置、下载完成后的导入策略，以及网页文件打开时的处理偏好。',
  },
  {
    chip: '调试向',
    title: '网页调试与兼容开关',
    body: '比如 User-Agent、权限提示、资源捕获偏好、缓存重载和页面诊断，也比较适合集中放在这里。',
  },
];

function renderSettingsCard(
  card: BrowserSettingsCard,
  onSectionChange: BrowserSettingsWorkspaceProps['onSectionChange'],
) {
  const interactive = Boolean(card.section);
  const openSection = () => {
    if (card.section) {
      onSectionChange(card.section);
    }
  };

  return (
    <div
      key={card.title}
      className={`browser-settings-card ${interactive ? 'browser-settings-card-clickable' : ''}`}
      onClick={interactive ? openSection : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive
        ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openSection();
            }
          }
        : undefined}
    >
      <span className="browser-settings-chip">{card.chip}</span>
      <div className="browser-settings-card-title">{card.title}</div>
      <div className="browser-settings-card-body">{card.body}</div>
    </div>
  );
}

const BrowserSettingsWorkspace: React.FC<BrowserSettingsWorkspaceProps> = ({
  section,
  onSectionChange,
}) => {
  const handleBack = React.useCallback(() => {
    onSectionChange(null);
  }, [onSectionChange]);

  if (section === 'cookies') {
    return (
      <BrowserSettingsContent>
        <EmbeddedBrowserCookieSettings onBack={handleBack} />
      </BrowserSettingsContent>
    );
  }

  if (section === 'passwords') {
    return (
      <BrowserSettingsContent>
        <EmbeddedBrowserPasswordSettings onBack={handleBack} />
      </BrowserSettingsContent>
    );
  }

  if (section === 'capture-rules') {
    return (
      <BrowserSettingsContent>
        <EmbeddedBrowserCaptureRuleSettings onBack={handleBack} />
      </BrowserSettingsContent>
    );
  }

  if (section === 'external-tools') {
    return (
      <BrowserSettingsContent>
        <EmbeddedBrowserExternalToolSettings onBack={handleBack} />
      </BrowserSettingsContent>
    );
  }

  return (
    <BrowserSettingsContent>
      <div className="browser-settings-hero">
        <span className="browser-settings-eyebrow">浏览器设置</span>
        <div className="browser-settings-intro">
          <div className="browser-settings-title">像浏览器内页一样放在主内容区域里</div>
          <div className="browser-settings-description">
            这里会逐步承接内置浏览器自己的配置。目录树和主框架不被遮挡，顶部也保留熟悉的标签页心智。
          </div>
        </div>
      </div>
      <div className="browser-settings-grid">
        {browserSettingsCards.map((card) => renderSettingsCard(card, onSectionChange))}
      </div>
      <div className="browser-settings-footer">
        现在先把结构做对，后面我们可以把每一项浏览器能力顺着这里往下加，不用再改头部布局。
      </div>
    </BrowserSettingsContent>
  );
};

export default BrowserSettingsWorkspace;
