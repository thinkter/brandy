import { createBrandy } from "brandy";

const app = await createBrandy({ appDir: new URL("./app", import.meta.url).pathname });
app.listen(3000);
console.log(`Brandy listening at ${app.server?.url}`);
