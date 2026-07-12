import { expect, test } from "@playwright/test";

test("loads workbench and navigates primary surfaces", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Promptbar" })).toBeVisible();
  await expect(page.getByText(/^6 prompts ·/i)).toBeVisible();

  const navigation = page.getByRole("complementary");

  await navigation.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Kind")).toBeVisible();

  const search = page.getByPlaceholder("Search corpus");
  await search.fill("termination");
  await search.press("Enter");
  const results = page.getByRole("article");
  await expect(results).toHaveCount(1);
  await expect(
    results.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();

  await navigation.getByRole("button", { name: "Editor" }).click();
  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();

  await navigation.getByRole("button", { name: "Evals" }).click();
  await expect(page.getByRole("button", { name: /Run/i })).toBeVisible();
});
