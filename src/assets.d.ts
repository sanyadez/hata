/** Files the server imports as text or as a path (`with { type: "text" | "file" }`): each is a string */
declare module "*.css" {
  const text: string;
  export default text;
}
declare module "*.js" {
  const text: string;
  export default text;
}
declare module "*.html" {
  const text: string;
  export default text;
}
declare module "*.svg" {
  const text: string;
  export default text;
}
declare module "*.woff2" {
  const path: string;
  export default path;
}
declare module "*.png" {
  const path: string;
  export default path;
}
declare module "*.yml" {
  const text: string;
  export default text;
}
