/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `damage_component_prices` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "damage_component_prices_name_key" ON "damage_component_prices"("name");
