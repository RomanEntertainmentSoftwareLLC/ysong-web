import Home from "./components/Home";
import Footer from "./components/Footer";

function Desktop() {
    return (
        <div className="min-h-screen grid place-items-start bg-transparent">
            <main className="w-full text-left font-sans pt-6 sm:pt-10">
                <Home />
                <Footer />
            </main>
        </div>
    );
}

export default Desktop;
