export default function Home() {
  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto min-h-screen max-w-md bg-white shadow-sm">
        <header className="bg-blue-700 px-6 py-8 text-white">
          <p className="text-sm font-medium">株式会社クレド</p>

          <h1 className="mt-2 text-2xl font-bold">
            入居者サポート
          </h1>

          <p className="mt-2 text-sm text-blue-100">
            暮らしのお困りごとをサポートします
          </p>
        </header>

        <section className="px-5 py-6">
          <h2 className="text-xl font-bold text-gray-900">
            お困りのことはございますか？
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            ご希望のメニューを選択してください。
          </p>

          <div className="mt-6 space-y-4">
<a
  href="/repair"
  className="flex w-full items-center rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm"
>
  <span className="mr-4 text-3xl">🔧</span>

  <div>
    <p className="font-bold text-gray-900">
      修理・不具合を報告する
    </p>

    <p className="mt-1 text-sm text-gray-500">
      設備の故障やお部屋の不具合
    </p>
  </div>
</a>
            <button className="flex w-full items-center rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm">
              <span className="mr-4 text-3xl">📢</span>

              <div>
                <p className="font-bold text-gray-900">
                  管理会社からのお知らせ
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  建物や暮らしに関するお知らせ
                </p>
              </div>
            </button>

            <button className="flex w-full items-center rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm">
              <span className="mr-4 text-3xl">💬</span>

              <div>
                <p className="font-bold text-gray-900">
                  お問い合わせ
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  管理会社へお問い合わせ
                </p>
              </div>
            </button>
          </div>
        </section>

        <footer className="px-5 py-8 text-center text-xs text-gray-400">
          株式会社クレド 管理部
        </footer>
      </div>
    </main>
  );
}