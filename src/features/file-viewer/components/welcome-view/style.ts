import styled from 'styled-components';
import Lemon from '@/assets/img/lemon.jpeg';

export const WelcomeWrapper = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;
  position: relative;

  .header {
    height: 100%;
    background-image: linear-gradient(
            to right bottom,
            rgba(227,124,155,0.7),
            rgba(225,153,161,0.4)
    ), url(${Lemon});
    background-repeat: no-repeat;
    background-position: center;
    background-size: cover;
    overflow: clip;
  }

  .logo-box {
    padding: 40px;
  }

  .logo {
    height: 55px;
  }

  .text-box {
    position: relative;
    top: 28%;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
  }

  .heading-primary {
    color: #fff;
    text-transform: uppercase;
    margin-bottom: 50px;
  }

  .heading-primary-main {
    display: block;
    font-size: 60px;
    font-weight: 400;
    letter-spacing: 35px;
    opacity: 0.6;
    animation: moveInLeft 3s ease;
  }

  .heading-primary-sub {
    display: block;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 17.4px;
    opacity: 0.6;
    animation: moveInRight 3s ease;
  }

  @keyframes moveInLeft {
    0% {
      opacity: 0;
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

  .btn:link,
  .btn:visited {
    display: inline-block;
    text-transform: uppercase;
    text-decoration: none;
    padding: 15px 40px;
    opacity: 0.9;
    border-radius: 8px;
    position: relative;
    transition: all .2s;
    animation: showKey 3.4s;
    background-color: #fff;
    color: #777;
  }

  .btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 20px rgba(0, 0, 0, .4);
  }

  .btn:active {
    transform: translateY(-1px);
    box-shadow: 0 5px 10px rgba(0, 0, 0, .8);
  }

  @keyframes showKey {
    0% { opacity: 0; }
    70% { opacity: 0; }
    100% { opacity: 0.9; }
  }

  .btn::after {
    content: "";
    display: inline-block;
    height: 100%;
    width: 100%;
    border-radius: 8px;
    position: absolute;
    top: 0;
    left: 0;
    z-index: -1;
    transition: all .4s;
    background-color: #fff;
  }

  .btn:hover::after {
    transform: scaleX(1.2) scaleY(1.6);
    opacity: 0;
  }
`;

