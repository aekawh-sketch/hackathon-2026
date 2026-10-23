// Если не загрузилась тяжёлая часть (3D, панорама), остальная карта продолжает работать.
import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
