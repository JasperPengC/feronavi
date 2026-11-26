CREATE TABLE product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  version integer NOT NULL DEFAULT 1 CONSTRAINT product_version_positive CHECK (version > 0),
  created_by uuid REFERENCES member(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE product_project (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES product(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_project_unique UNIQUE(product_id, project_id)
);
--> statement-breakpoint
CREATE INDEX product_project_project_idx ON product_project(project_id);
--> statement-breakpoint
ALTER TABLE work_item ADD COLUMN product_id uuid REFERENCES product(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE work_item ADD CONSTRAINT work_item_product_requirement CHECK (product_id IS NULL OR type = 'REQUIREMENT');
--> statement-breakpoint
ALTER TABLE work_item ADD CONSTRAINT work_item_product_project_fk FOREIGN KEY(product_id, project_id) REFERENCES product_project(product_id, project_id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX work_item_product_idx ON work_item(product_id, project_id);
