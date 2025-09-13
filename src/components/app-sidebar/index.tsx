import {FC, ReactNode} from "react";
import {SidebarWrapper} from "@/components/app-sidebar/style.ts";

interface IProps {
  children?: ReactNode
}

const Index: FC<IProps> = () => {
  return (
    <SidebarWrapper>
      <p>菜单 1</p>
      <p>菜单 2</p>
      <p>菜单 3</p>
    </SidebarWrapper>
  )
}

export default Index