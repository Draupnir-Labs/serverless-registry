// Vite-style raw content import. Lets tests load file contents as a string,
// e.g. import schema from "../migrations/0001_create_reads_table.sql?raw".
declare module "*?raw" {
  const content: string;
  export default content;
}
