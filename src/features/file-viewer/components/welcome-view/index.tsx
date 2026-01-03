import React from 'react';
import { WelcomeWrapper } from './style';
import ReactLogo from "@/assets/img/React.svg";

/**
 * 默认欢迎页面组件
 * 展示品牌的 Slogan 和 Logo
 */
const WelcomeView: React.FC = () => {
  return (
    <WelcomeWrapper>
      <header className="header">
        <div className="logo-box">
          <img src={ReactLogo} alt="Logo" className="logo"/>
        </div>
        <div className="text-box">
          <h1 className="heading-primary">
            <span className="heading-primary-main">Outdoors</span>
            <span className="heading-primary-sub">is where life happens</span>
          </h1>
          <a href="#" className="btn">Discover our tours</a>
        </div>
      </header>
    </WelcomeWrapper>
  );
};

export default WelcomeView;

