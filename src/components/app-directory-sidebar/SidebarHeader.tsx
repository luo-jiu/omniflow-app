import { Select } from '@douyinfe/semi-ui';
import { useRepositoryTree } from '@/hooks/directory-sidebar/useRepositoryTree';

// 仓库下拉框
export default function SidebarHeader() {
  const { repositories, selectedRepository, selectRepository } = useRepositoryTree();

  return (
    <div className="repository-selector">
      <Select
        value={selectedRepository}
        onChange={(value) => {
          if (typeof value === 'string') {
            void selectRepository(value);
          }
        }}
        style={{ width: '100%' }}
        placeholder="选择仓库"
      >
        {repositories.map(repo => (
          <Select.Option key={repo.id} value={String(repo.id)}>
            {repo.name}
          </Select.Option>
        ))}
      </Select>
    </div>
  );
}