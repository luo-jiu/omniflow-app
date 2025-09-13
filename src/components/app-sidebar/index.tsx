import {FC, ReactNode} from "react";
import {SidebarWrapper} from "@/components/app-sidebar/style.ts";
import {Nav} from "@douyinfe/semi-ui";

interface IProps {
  children?: ReactNode
}

const Index: FC<IProps> = () => {
  return (
    <SidebarWrapper>
      <Nav
        style={{ height: '100%' }}
        bodyStyle={{ flexGrow: 1, overflow: 'auto' }}
        items={[
          { itemKey: 'files', text: '文件' },
          { itemKey: 'settings', text: '设置' },
        ]}
      />
    </SidebarWrapper>
  )
}

export default Index