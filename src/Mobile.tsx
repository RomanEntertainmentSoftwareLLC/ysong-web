import Home from "./components/Home";
import Footer from "./components/Footer";

function Mobile() {
	return (
		<div className="min-h-screen grid place-items-center bg-transparent">
			<main className="text-left font-sans">
				<section className="pt-24 sm:pt-10">
					<Home />
				</section>
				<Footer />
			</main>
		</div>
	);
}

export default Mobile;
