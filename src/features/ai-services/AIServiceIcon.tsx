type AIServiceIconProps = {
  className?: string;
};

export default function AIServiceIcon({ className = '' }: AIServiceIconProps) {
  return (
    <span className={`ai-service-glyph ${className}`.trim()} aria-hidden="true">
      AI
    </span>
  );
}
