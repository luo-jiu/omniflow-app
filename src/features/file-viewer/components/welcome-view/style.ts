import styled from 'styled-components';

export const WelcomeWrapper = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: auto;

  .panel {
    width: min(600px, 100%);
    padding: 32px;
    text-align: center;
  }

  .eyebrow {
    display: inline-flex;
    align-items: center;
    padding: 5px 12px;
    border-radius: 4px;
    background: var(--app-accent-soft);
    color: var(--app-accent);
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h1 {
    margin-top: 18px;
    font-size: 28px;
    line-height: 1.2;
    letter-spacing: -0.02em;
    font-weight: 600;
  }

  p {
    margin-top: 12px;
    max-width: 480px;
    margin-left: auto;
    margin-right: auto;
    color: var(--app-text-secondary);
    font-size: 15px;
    line-height: 1.7;
  }

  .tips {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 28px;
  }

  .tip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-radius: 10px;
    background: var(--app-bg-elevated);
    border: 1px solid var(--app-border);
    text-align: left;
  }

  .tip-label {
    color: var(--app-text);
    font-size: 14px;
    font-weight: 500;
  }

  .tip-text {
    color: var(--app-text-muted);
    font-size: 13px;
    line-height: 1.5;
  }
`;
