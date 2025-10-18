import {FC, ReactNode} from "react";
import MainWrapper from "@/components/app-main/style.ts";
import ReactLogo from "@/image/React.svg";

interface IProps {
  children?: ReactNode;
}

const AppMain: FC<IProps> = () => {
  return (
    <MainWrapper>
      <header className="header">
        <div className="logo-box">
          <img src={ReactLogo} alt="Logo" className="logo"/>
        </div>
        <div className="text-box">
          <h1 className="heading-primary">
            <span className="heading-primary-main">Outdoors</span>
            <span className="heading-primary-sub">is where life happens</span>
          </h1>
          <a href="#" className="btn btn-white">Discover our tours</a>
        </div>
      </header>
    </MainWrapper>
  );
}

export default AppMain;
