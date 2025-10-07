export default function Legal() {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl sm:text-4xl font-bold">Legal Information</h1>
      <p className="mt-4 opacity-80">
        Placeholder page. Your Terms of Service, licensing, and other legal
        details will live here.
      </p>
      <ul className="mt-6 list-disc pl-6 space-y-2">
        <li>Company: Roman Entertainment Software LLC</li>
        <li>Contact: hello@ysong.ai (example)</li>
        <li>Last updated: {new Date().toLocaleDateString()}</li>
      </ul>
    </div>
  );
}
