export {};

declare global {
  namespace JSX {
    interface HtmlTag extends BrandyAlpineAttributes {}

    interface BrandyAlpineAttributes {
      "x-data"?: string;
      "x-init"?: string;
      "x-show"?: string;
      "x-if"?: string;
      "x-for"?: string;
      "x-bind"?: string;
      "x-model"?: string;
      "x-on"?: string;
      "x-ref"?: string;
      "x-text"?: string;
      "x-html"?: string;
      "x-transition"?: string;
      "x-effect"?: string;
      "x-ignore"?: string;
      "x-cloak"?: string;
      "x-teleport"?: string;
      "x-id"?: string;

      [directive: `x-on:${string}`]: string | undefined;
      [directive: `x-bind:${string}`]: string | undefined;
      [directive: `x-model.${string}`]: string | undefined;
      [directive: `x-show.${string}`]: string | undefined;
      [directive: `x-transition:${string}`]: string | undefined;
      [directive: `x-transition.${string}`]: string | undefined;
      [directive: `x-ignore.${string}`]: string | undefined;
    }
  }
}
