import {FC, ReactNode} from "react";
import {SidebarWrapper} from "./style.ts";
import {Nav} from "@douyinfe/semi-ui";
import { IconFolder, IconSetting } from '@douyinfe/semi-icons';

interface IProps {
  children?: ReactNode
}

const Index: FC<IProps> = () => {
  return (
    <SidebarWrapper>
      <Nav
        className="app-rail-nav"
        style={{ height: '100%' }}
        bodyStyle={{ flexGrow: 1, overflow: 'auto' }}
        items={[
          { itemKey: 'files', text: '文件', icon: <IconFolder /> },
          { itemKey: 'settings', text: '设置', icon: <IconSetting /> },
        ]}
      />
    </SidebarWrapper>
  )
}

export default Index
