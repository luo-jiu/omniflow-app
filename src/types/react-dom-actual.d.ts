declare module 'react-dom-actual' {
  export * from 'react-dom';

  const ReactDOMActual: typeof import('react-dom');
  export default ReactDOMActual;
}
