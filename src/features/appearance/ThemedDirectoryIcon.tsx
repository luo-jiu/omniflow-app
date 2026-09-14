import { useContext, type ImgHTMLAttributes } from 'react';
import { AppearanceViewContext } from './appearance.context';

const outlines = import.meta.glob('../../assets/icons/outline-folders/*.svg', { eager: true, import: 'default', query: '?url' }) as Record<string, string>;
export default function ThemedDirectoryIcon(props: { src: string; alt: string; assetName: string } & ImgHTMLAttributes<HTMLImageElement>) {
  const view = useContext(AppearanceViewContext);
  const { assetName, src: fallback, alt, ...rest } = props;
  const src = view?.iconThemeId === 'omniflow.outline'
    ? outlines[`../../assets/icons/outline-folders/${assetName}.svg`] ?? outlines[`../../assets/icons/outline-folders/${assetName.replace(/-open$/, '')}.svg`] ?? fallback
    : fallback;
  return <img className={`tree-file-type-icon tree-file-type-icon-${alt}`} width={15} height={15} draggable={false} {...rest} src={src} alt={alt} />;
}
