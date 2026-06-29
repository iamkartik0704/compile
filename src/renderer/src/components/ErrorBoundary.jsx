import React from 'react'
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    if (window.api && window.api.saveFileContents) {
      window.api.saveFileContents('c:/Users/iamka/Desktop/comiple ide testing 2/react-error.log', error.stack + '\n\n' + errorInfo.componentStack);
    }
  }
  render() {
    if (this.state.hasError) {
      return <h1>Something went wrong.</h1>;
    }
    return this.props.children;
  }
}
