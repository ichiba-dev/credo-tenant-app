export type RepairPhoto = {
  repair_id: number;
  photo_url: string;
  sort_order: number | null;
};

export type EstimateFile = {
  id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  sort_order: number;
  created_at: string;
};

export type OwnerReportEstimates = {
  files: EstimateFile[];
  unavailable?: boolean;
};

export type AdminRepair = {
  id: number;
  property_name: string;
  room_number: string;
  tenant_name: string;
  category: string;
  description: string;
  status: string;
  history: string | null;
  staff_comment: string | null;
  created_at: string;
  photo_url: string | null;
  repair_photos: RepairPhoto[];
  photos_unavailable?: boolean;
  owner_report_estimates: OwnerReportEstimates | null;
  tenant_messages?: TenantRepairMessage[];
};

export type TenantRepairMessage = {
  id: string;
  sender_type: "tenant" | "staff";
  sender_name: string;
  message: string;
  created_at: string;
};
