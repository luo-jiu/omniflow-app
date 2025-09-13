import {FC, ReactNode} from "react";
import {HeaderWrapper} from "@/components/app-header/style.ts";

interface IProps {
  children?: ReactNode
}

const AppHeader: FC<IProps> = () => {
  return (
    <HeaderWrapper>
      <h1>顶部工具栏</h1>
    </HeaderWrapper>
  )
}

export default AppHeader