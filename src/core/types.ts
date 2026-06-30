export type RenderResult = JSX.Element | string | Promise<JSX.Element | string>;

export interface PageModule {
  default: () => RenderResult;
}

export interface LayoutModule {
  default: (props: { children: JSX.Element }) => RenderResult;
}

export interface LayoutNode {
  id: string;
  file: string;
  render: LayoutModule["default"];
}

export interface Route {
  id: string;
  pattern: string;
  segments: string[];
  layouts: LayoutNode[];
  pageFile: string;
  renderPage: PageModule["default"];
}

export interface RouteManifest {
  appDir: string;
  routes: Route[];
}

export interface RouteMatch {
  route: Route;
  pathname: string;
}

export interface RouteDiff {
  current: RouteMatch;
  target: RouteMatch;
  boundary: LayoutNode;
  chainToRender: LayoutNode[];
}
