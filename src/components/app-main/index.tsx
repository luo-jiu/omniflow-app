import {FC, ReactNode} from "react";
import MainWrapper from "@/components/app-main/style.ts";

interface IProps {
  children?: ReactNode
}

const AppMain: FC<IProps> = () => {
  return (
    <MainWrapper>
      <h1>顶部工具栏</h1>
    </MainWrapper>
  )
}

export default AppMain