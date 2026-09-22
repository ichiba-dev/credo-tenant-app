export type UnassignedLineAttachment = {
  id: string;
  tenant_name: string;
  media_type: "image" | "pdf";
  original_filename: string | null;
  file_size: number;
  created_at: string;
};

export type LineRepairCandidate = {
  id: number;
  property_name: string | null;
  room_number: string | null;
  category: string | null;
  description: string;
  created_at: string;
  status: string | null;
};

export type UnassignedLineMessage = {
  id: string;
  tenant_name: string;
  message: string;
  created_at: string;
};

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

export type VendorCandidate = {
  id: string;
  companyName: string;
  contactName: string;
  phone: string | null;
  email: string | null;
  categories: string[];
  areas: { areaCode: string; areaLabel: string }[];
};

export type VendorDispatchMessage = {
  id: string;
  channel: string;
  messageBody: string;
  recipientLabel: string;
  recipientAddress: string | null;
  deliveryStatus: string;
  sentAt: string | null;
  sentByName: string;
};

export type VendorDispatchEvent = {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  occurredAt: string;
  actorName: string;
};

export type VendorDispatchHistory = {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorContactName: string;
  vendorPhone: string | null;
  vendorEmail: string | null;
  status: string;
  instructions: string;
  selectedAt: string;
  assignedByName: string;
  events: VendorDispatchEvent[];
  messages: VendorDispatchMessage[];
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
  line_messages_unavailable?: boolean;
  line_attachments_unavailable?: boolean;
  vendor_dispatches?: VendorDispatchHistory[];
  vendor_candidates?: VendorCandidate[];
  vendor_dispatch_unavailable?: boolean;
};

export type TenantRepairMessage = {
  attachment?: { id: string; media_type: "image" | "pdf"; original_filename: string | null; file_size: number; outbound?: boolean };
  channel?: "line";
  id: string;
  sender_type: "tenant" | "staff";
  sender_name: string;
  message: string;
  created_at: string;
};
