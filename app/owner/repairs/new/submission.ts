import 'server-only';
import { randomUUID } from 'node:crypto';
import { getOwnerRequestContext, getOwnerRequestProperties } from './data';
import { MAX_PHOTOS, MAX_PHOTO_BYTES, MAX_TOTAL_PHOTO_BYTES, PHOTO_TYPES } from '@/app/repair/upload-limits';

export async function submitOwnerRepair(form: FormData) {
  let requestCreated = false;
  let writeAttempted = false;
  let repairId: number | undefined;
  try {
    const context = await getOwnerRequestContext();
    const fields = ['propertyId','locationType','roomNumber','category','description','contactNotes'];
    if ([...form.keys()].some(key => !fields.includes(key) && key !== 'photos') || fields.some(key => form.getAll(key).length !== 1)) throw new Error('INVALID');
    const values = fields.map(key => form.get(key));
    if (values.some(value => typeof value !== 'string')) throw new Error('INVALID');
    const [propertyId, locationType, roomNumber, category, description, contactNotes] = values as string[];
    if (!/^[0-9a-f-]{36}$/i.test(propertyId) || !['room','common_area'].includes(locationType) ||
        (locationType === 'room' ? !roomNumber.trim() || roomNumber.length > 100 : roomNumber !== '') ||
        !['エアコン','給湯器','キッチン','浴室','トイレ','洗面所','玄関・鍵','共用部','その他'].includes(category) ||
        !description.trim() || description.length > 10000 || contactNotes.length > 2000) throw new Error('INVALID');
    const files = form.getAll('photos');
    if (files.length > MAX_PHOTOS) throw new Error('INVALID');
    let total = 0;
    const photos: { file: File; ext: string }[] = [];
    for (const file of files) {
      if (typeof file === 'string' || !PHOTO_TYPES.includes(file.type) || !file.size || file.size > MAX_PHOTO_BYTES) throw new Error('INVALID');
      total += file.size;
      if (total > MAX_TOTAL_PHOTO_BYTES) throw new Error('INVALID');
      const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const png = [137,80,78,71,13,10,26,10];
      if (file.type === 'image/png' ? !png.every((value,index) => header[index] === value) : !(header[0] === 255 && header[1] === 216 && header[2] === 255)) throw new Error('INVALID');
      photos.push({ file, ext: file.type === 'image/png' ? 'png' : 'jpg' });
    }
    const properties = await getOwnerRequestProperties(context);
    if (!properties.some(property => property.id === propertyId)) throw new Error('OWNER_PROPERTY_FORBIDDEN');
    // RPC checks auth.uid(), active ownership and organization again in the insert transaction.
    writeAttempted = true;
    const { data: created, error } = await context.auth.rpc('create_owner_repair', {
      p_property: propertyId, p_location: locationType, p_room: locationType === 'room' ? roomNumber.trim() : null,
      p_category: category, p_description: description.trim(), p_contact_notes: contactNotes.trim(),
    });
    if (error || !Number.isSafeInteger(created) || created <= 0) throw new Error('CREATE_UNCONFIRMED');
    requestCreated = true;
    repairId = created;
    if (photos.length) {
      const { data: repair, error: lookupError } = await context.service.from('repair_requests')
        .select('id,organization_id,property_id,source_type,source_owner_id').eq('id', repairId)
        .eq('organization_id', context.owner.organization_id).eq('source_owner_id', context.owner.id).maybeSingle();
      if (lookupError || !repair || repair.id !== repairId || repair.organization_id !== context.owner.organization_id ||
          repair.property_id !== propertyId || repair.source_type !== 'owner' || repair.source_owner_id !== context.owner.id) throw new Error('PHOTO_SCOPE');
      for (const [index, photo] of photos.entries()) {
        const path = `${context.owner.organization_id}/${repairId}/${randomUUID()}.${photo.ext}`;
        const { data: uploaded, error: uploadError } = await context.service.storage.from('repair-images')
          .upload(path, photo.file, { contentType: photo.file.type, upsert: false });
        if (uploadError || uploaded?.path !== path) throw new Error('PHOTO_UPLOAD');
        const { error: photoError } = await context.service.from('repair_photos').insert({
          organization_id: context.owner.organization_id, repair_id: repairId, storage_path: path,
          photo_url: null, sort_order: index + 1, source_type: 'owner', source_channel: 'web',
        });
        if (photoError) throw new Error('PHOTO_REGISTER');
      }
    }
    return { ok: true as const, repairId };
  } catch {
    return { ok: false as const, requestCreated, retrySafe: !writeAttempted,
      message: requestCreated ? `修理依頼（案件${repairId}）は登録済みですが、写真の処理に失敗しました。再送せず管理会社へお問い合わせください。`
        : writeAttempted ? '登録結果を確認できませんでした。重複を避けるため、再送前に管理会社へお問い合わせください。'
        : 'ログイン・物件・入力内容を確認してください。写真はJPEG・PNG、最大20枚、1枚5MiB・合計20MiBまでです。' };
  }
}
