import styled from 'styled-components';
import Lemon from '@/image/lemon.jpeg';

export const MainWrapper = styled.main`
  flex: 1;
  padding: 16px;
  overflow: auto;
  background: var(--semi-color-bg-0);
  color: var(--semi-color-text-0);
  
  body {
    font-family: "Lato", sans-serif;
    font-weight: 400;
    font-size: 16px;
    line-height: 1.7;
    color: #777; 
    padding: 30px;
  }

  .header {
    height: 100%; /* 背景必须有高度才能显示 */
    background-image: linear-gradient(
            to right bottom,
            rgba(227,124,155,0.7),
            rgba(225,153,161,0.4)
    ), url(${Lemon});
    background-repeat: no-repeat;   /* 不要平铺 */
    background-position: center;    /* 始终居中 */
    background-size: cover;         /* 等比缩放，保证撑满容器 */
    overflow: clip;                 /* 消除因为动画溢出产生的滚动条 */
  }

  .logo-box {
    //position: absolute;  /* 将元素的定位方式设置为绝对定位 */
    top: 40px;
    left: 40px;
  }

  .logo {
    height: 55px;
  }

  .text-box {
    position: relative;
    top: 28%;
    left: 50%;
    transform: translateX(-50%);  /* 水平居中 */
    text-align: center; /* 让文本框居中 */
  }

  .heading-primary {
    color: #fff;
    text-transform: uppercase; /* 将文本转换为 uppercase（全部大写）形式 */
    margin-bottom: 50px; /* 盒子之间的模式，这里是底部距离其他盒子间隙 */
  }

  .heading-primary-main {
    display: block;
    font-size: 60px;
    font-weight: 400;
    letter-spacing: 35px; /* 字间距 */
    opacity: 0.6;

    /* 指定动画名称、运行时间、动画延迟时间 */
    animation-name: moveInLeft;
    animation-duration: 3s;
    /* animation-delay: 1s; */
    animation-timing-function: ease;
  }

  .heading-primary-sub {
    display: block;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 17.4px;
    opacity: 0.6;

    animation: moveInRight 3s ease; /* 写在一起会自动识别 */
  }

  /* 
  关键帧动画@keyframes 
  让动画从左边进来
  */
  @keyframes moveInLeft {
    0% {
      opacity: 0; /* 动画刚开始，希望看不见，所以这里透明的为0 */
      transform: translate(-80px, 120px);
    }
    40% {
      transform: translate(10px, 120px);
    }
    70% {
      opacity: 1;
      transform: translate(0, 120px);
    }
    100% {
      opacity: 0.6;
      transform: translate(0);
    }
  }

  @keyframes moveInRight {
    0% {
      opacity: 0;
      transform: translate(80px, 120px);
    }
    40% {
      transform: translate(-10px, 120px);
    }
    70% {
      opacity: 1;
      transform: translate(0, 120px);
    }
    100% {
      opacity: 0.6;
      transform: translate(0);
    }
  }

  /* 初始状态 */
  .btn:link,
  .btn:visited {
    display: inline-block;
    text-transform: uppercase;
    text-decoration: none; /* 去除原有下划线 */
    padding: 15px 40px;
    opacity: 0.9;
    border-radius: 8px; /* 圆角 */
    position: relative;

    /*
    对所有可过渡的属性都停驾过去效果；
    当元素的CSS属性发生变化时（例如:hover状态下的样式改变），
    不会立即切换到新样式，而是在0.2秒内平滑地过渡，
    使界面交互更加流畅自然，避免了样式突变带来的生硬感
    */
    transition: all .2s;
    animation: showKey 3.4s;
  }

  /* 鼠标悬停时 */
  .btn:hover {
    transform: translateY(-3px);
    /* 控制投影，参数分别是：x,y,模糊半径，颜色 */
    box-shadow: 0 10px 20px rgba(0, 0, 0, .4);
  }

  /* 鼠标触发时 */
  .btn:active {
    transform: translateY(-1px);
    box-shadow: 0 5px 10px rgba(0, 0, 0, .8);
  }

  .btn-white {
    background-color: #fff;
    color: #777;
  }

  @keyframes showKey {
    0% {
      opacity: 0;
    }
    70% {
      opacity: 0;
    }
    100% {
      opacity: 0.9;
    }
  }

  .btn::after {
    content: ""; /* 生成一个空盒子 */
    display: inline-block;
    /* 盒子和原有宽高一样 */
    height: 100%;
    width: 100%;
    border-radius: 8px;

    position: absolute;
    top: 0;
    left: 0;
    z-index: -1;
    transition: all .4s;
  }

  .btn-white::after {
    background-color: #fff;
  }

  /* 鼠标悬停时，改变btn::after生成的盒子 */
  .btn:hover::after {
    transform: scaleX(1.2) scaleY(1.6); /* 扩大为原来的几倍 */
    opacity: 0;
  }

  /* 文件查看器样式 */
  .file-viewer {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
  }

  .file-viewer-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .file-viewer-content {
    width: 100%;
    max-width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .file-viewer-image {
    max-width: 100%;
    max-height: calc(100% - 60px);
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .file-viewer-video {
    max-width: 100%;
    max-height: calc(100% - 60px);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .file-viewer-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--semi-color-text-0);
    text-align: center;
    padding: 8px 16px;
    background: var(--semi-color-bg-1);
    border-radius: 6px;
    max-width: 80%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-viewer-other {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 40px;
    text-align: center;
  }

  .file-viewer-filename {
    font-size: 14px;
    color: var(--semi-color-text-2);
    word-break: break-all;
  }

  .file-viewer-download {
    display: inline-block;
    padding: 10px 20px;
    background: var(--semi-color-primary);
    color: white;
    text-decoration: none;
    border-radius: 6px;
    transition: background 0.2s;
    
    &:hover {
      background: var(--semi-color-primary-hover);
    }
  }
`

export default MainWrapper;