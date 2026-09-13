"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { src: string; alt: string; className: string; onRetry?: () => void };

function ImageWithRetry({ src, alt, className, onRetry }: Props) {
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  const retry = () => onRetry ? onRetry() : router.refresh();
  if (failed) return <span role="alert" className="block p-3 text-sm text-red-700">
    写真を読み込めませんでした。
    <span role="button" tabIndex={0} className="ml-2 cursor-pointer underline"
      onClick={(event) => { event.stopPropagation(); retry(); }}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); retry(); } }}>
      再読み込み
    </span>
  </span>;
  // 期限付きURLをNext Imageの共有最適化キャッシュへ載せない。
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

export default function RepairImage(props: Props) {
  return <ImageWithRetry key={props.src} {...props} />;
}
